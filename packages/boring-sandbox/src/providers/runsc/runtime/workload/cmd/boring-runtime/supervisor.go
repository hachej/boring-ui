package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

type invocationEnvelope struct {
	Version        int    `json:"version"`
	Control        string `json:"control,omitempty"`
	Command        string `json:"command"`
	Cwd            string `json:"cwd"`
	TimeoutMillis  int    `json:"timeoutMs"`
	MaxOutputBytes int    `json:"maxOutputBytes"`
	GraceMillis    int    `json:"graceMs"`
}

type invocationResponse struct {
	OK             bool   `json:"ok"`
	StdoutBase64   string `json:"stdoutBase64"`
	StderrBase64   string `json:"stderrBase64"`
	ExitCode       int    `json:"exitCode"`
	DurationMillis int64  `json:"durationMs"`
	Truncated      bool   `json:"truncated"`
	TimedOut       bool   `json:"timedOut"`
	CleanupProven  bool   `json:"cleanupProven"`
}

type boundedOutput struct {
	mu        sync.Mutex
	remaining int
	stdout    bytes.Buffer
	stderr    bytes.Buffer
	truncated bool
}

type streamWriter struct {
	output *boundedOutput
	stderr bool
}

func supervise() error {
	if os.Getpid() != 1 {
		return errors.New("supervisor must be pid 1")
	}
	_, _, errno := syscall.RawSyscall6(syscall.SYS_PRCTL, prSetChildSubreaper, 1, 0, 0, 0, 0)
	if errno != 0 {
		return errno
	}
	if err := prepareControlDirectory(); err != nil {
		return err
	}
	if err := os.Remove(socketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	if err := os.Chmod(socketPath, 0o600); err != nil {
		return err
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-stop
		listener.Close()
	}()
	for {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			select {
			case <-stop:
				return nil
			default:
				return acceptErr
			}
		}
		handleInvocation(connection)
	}
}

func handleInvocation(connection net.Conn) {
	defer connection.Close()
	if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return
	}
	peer, err := unixPeerCredential(connection)
	if err != nil || !authorizedSupervisorPeer(peer, peerProcessAlive) {
		return
	}
	request, err := readFramed(connection, maxEnvelopeBytes)
	if err != nil {
		return
	}
	defer zero(request)
	if !authorizedSupervisorPeer(peer, peerProcessAlive) {
		return
	}
	metadata, credentials, err := decodeInvocationFrame(request)
	if err != nil {
		return
	}
	var envelope invocationEnvelope
	if err := decodeStrictJSON(metadata, &envelope); err != nil {
		return
	}
	if err := connection.SetDeadline(time.Now().Add(16 * time.Minute)); err != nil {
		return
	}
	if envelope.Control == "baseline" {
		clean := cleanupTenantProcesses(int(peer.Pid), 2*time.Second)
		_ = json.NewEncoder(connection).Encode(map[string]bool{"ok": clean})
		return
	}
	response := runInvocation(&envelope, credentials, int(peer.Pid))
	clearEnvelope(&envelope)
	_ = json.NewEncoder(connection).Encode(response)
}

func runInvocation(
	envelope *invocationEnvelope,
	credentials []byte,
	peerPID int,
) invocationResponse {
	started := time.Now()
	response := invocationResponse{OK: true, ExitCode: -1}
	if err := validateInvocation(envelope); err != nil {
		response.CleanupProven = cleanupTenantProcesses(peerPID, 2*time.Second)
		return response
	}
	if !cleanupTenantProcesses(peerPID, time.Duration(envelope.GraceMillis)*time.Millisecond) {
		return response
	}

	output := &boundedOutput{remaining: envelope.MaxOutputBytes}
	command := exec.Command("/bin/sh", "-c", envelope.Command)
	command.Dir = envelope.Cwd
	command.Env = []string{
		"HOME=/workspace",
		"LANG=C.UTF-8",
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		"TMPDIR=/tmp",
	}
	command.Stdout = streamWriter{output: output}
	command.Stderr = streamWriter{output: output, stderr: true}
	command.SysProcAttr = tenantProcessAttributes()
	var credentialReader *os.File
	var credentialWriter *os.File
	if len(credentials) > 0 {
		var pipeErr error
		credentialReader, credentialWriter, pipeErr = os.Pipe()
		if pipeErr != nil {
			response.CleanupProven = cleanupTenantProcesses(peerPID, 2*time.Second)
			return response
		}
		command.ExtraFiles = []*os.File{credentialReader}
	}
	if err := command.Start(); err != nil {
		if credentialReader != nil {
			credentialReader.Close()
			credentialWriter.Close()
		}
		response.CleanupProven = cleanupTenantProcesses(peerPID, 2*time.Second)
		return response
	}
	var credentialWriteDone chan struct{}
	if credentialReader != nil {
		credentialReader.Close()
		credentialWriteDone = make(chan struct{})
		go func() {
			defer close(credentialWriteDone)
			defer credentialWriter.Close()
			remaining := credentials
			for len(remaining) > 0 {
				written, err := credentialWriter.Write(remaining)
				if err != nil || written <= 0 {
					return
				}
				remaining = remaining[written:]
			}
		}()
	}

	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	timer := time.NewTimer(time.Duration(envelope.TimeoutMillis) * time.Millisecond)
	var waitErr error
	preWaitCleanupProven := true
	select {
	case waitErr = <-done:
		terminateProcessGroup(
			command.Process.Pid,
			time.Duration(envelope.GraceMillis)*time.Millisecond,
		)
	case <-timer.C:
		response.TimedOut = true
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGTERM)
		grace := time.NewTimer(time.Duration(envelope.GraceMillis) * time.Millisecond)
		select {
		case waitErr = <-done:
			if !grace.Stop() {
				<-grace.C
			}
		case <-grace.C:
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			preWaitCleanupProven = cleanupTenantProcesses(
				peerPID,
				time.Duration(envelope.GraceMillis)*time.Millisecond,
			)
			select {
			case waitErr = <-done:
			case <-time.After(time.Duration(envelope.GraceMillis) * time.Millisecond):
				if credentialWriter != nil {
					credentialWriter.Close()
					<-credentialWriteDone
				}
				response.DurationMillis = time.Since(started).Milliseconds()
				response.ExitCode = 124
				response.CleanupProven = false
				return response
			}
		}
	}
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}

	response.ExitCode = exitCode(waitErr, response.TimedOut)
	response.DurationMillis = time.Since(started).Milliseconds()
	output.mu.Lock()
	response.StdoutBase64 = base64.StdEncoding.EncodeToString(output.stdout.Bytes())
	response.StderrBase64 = base64.StdEncoding.EncodeToString(output.stderr.Bytes())
	response.Truncated = output.truncated
	output.mu.Unlock()
	response.CleanupProven = preWaitCleanupProven && cleanupTenantProcesses(
		peerPID,
		time.Duration(envelope.GraceMillis)*time.Millisecond,
	)
	if credentialWriter != nil {
		credentialWriter.Close()
		<-credentialWriteDone
	}
	return response
}

func tenantProcessAttributes() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGKILL,
		Credential: &syscall.Credential{
			Uid:    tenantUID,
			Gid:    tenantGID,
			Groups: []uint32{},
		},
	}
}

func prepareControlDirectory() error {
	if err := os.Mkdir(controlDirectory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := os.Lstat(controlDirectory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		return errors.New("invalid supervisor control directory")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != supervisorUID || stat.Gid != supervisorGID {
		return errors.New("invalid supervisor control directory owner")
	}
	return nil
}

func validateInvocation(envelope *invocationEnvelope) error {
	if envelope.Version != 1 || len(envelope.Command) == 0 || len(envelope.Command) > maxCommandBytes {
		return errors.New("invalid command")
	}
	if !workspaceCwd(envelope.Cwd) {
		return errors.New("invalid cwd")
	}
	if envelope.TimeoutMillis <= 0 || envelope.TimeoutMillis > maxTimeoutMillis ||
		envelope.GraceMillis <= 0 || envelope.GraceMillis > maxGraceMillis ||
		envelope.MaxOutputBytes <= 0 || envelope.MaxOutputBytes > maxOutputBytes {
		return errors.New("invalid limits")
	}
	return nil
}

func workspaceCwd(value string) bool {
	if len(value) == 0 || len(value) > maxPathBytes || strings.ContainsRune(value, 0) {
		return false
	}
	if value != workspaceRoot && !strings.HasPrefix(value, workspaceRoot+"/") {
		return false
	}
	for _, component := range strings.Split(value, "/") {
		if component == ".." {
			return false
		}
	}
	return true
}

func cleanupTenantProcesses(excludedPID int, grace time.Duration) bool {
	pids, err := tenantPIDs(excludedPID)
	if err != nil {
		return false
	}
	for _, pid := range pids {
		_ = syscall.Kill(pid, syscall.SIGTERM)
	}
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		reapChildren()
		remaining, listErr := tenantPIDs(excludedPID)
		if listErr != nil {
			return false
		}
		if len(remaining) == 0 {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	remaining, err := tenantPIDs(excludedPID)
	if err != nil {
		return false
	}
	for _, pid := range remaining {
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
	for attempt := 0; attempt < 200; attempt++ {
		reapChildren()
		remaining, err = tenantPIDs(excludedPID)
		if err != nil {
			return false
		}
		if len(remaining) == 0 {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

func tenantPIDs(excludedPID int) ([]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var pids []int
	for _, entry := range entries {
		var pid int
		if _, scanErr := fmt.Sscanf(entry.Name(), "%d", &pid); scanErr != nil {
			continue
		}
		if pid > 1 && pid != excludedPID {
			pids = append(pids, pid)
		}
	}
	return pids, nil
}

func reapChildren() {
	for {
		var status syscall.WaitStatus
		pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
		if pid <= 0 || (err != nil && !errors.Is(err, syscall.EINTR)) {
			return
		}
	}
}

func processGroupAlive(pid int) bool {
	err := syscall.Kill(-pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func terminateProcessGroup(pid int, grace time.Duration) {
	if !processGroupAlive(pid) {
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	deadline := time.Now().Add(grace)
	for processGroupAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if processGroupAlive(pid) {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}

func exitCode(waitErr error, timedOut bool) int {
	if timedOut {
		return 124
	}
	if waitErr == nil {
		return 0
	}
	var exitError *exec.ExitError
	if errors.As(waitErr, &exitError) {
		return exitError.ExitCode()
	}
	return -1
}

func (writer streamWriter) Write(value []byte) (int, error) {
	writer.output.mu.Lock()
	defer writer.output.mu.Unlock()
	accepted := len(value)
	if accepted > writer.output.remaining {
		accepted = writer.output.remaining
		writer.output.truncated = true
	}
	if accepted > 0 {
		if writer.stderr {
			_, _ = writer.output.stderr.Write(value[:accepted])
		} else {
			_, _ = writer.output.stdout.Write(value[:accepted])
		}
		writer.output.remaining -= accepted
	}
	return len(value), nil
}

func clearEnvelope(envelope *invocationEnvelope) {
	envelope.Command = ""
	envelope.Cwd = ""
}
