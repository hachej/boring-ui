package main

import (
	"strings"
	"syscall"
	"testing"
)

func validTestEnvelope() invocationEnvelope {
	return invocationEnvelope{
		Version:        1,
		Command:        "printf ok",
		Cwd:            workspaceRoot,
		Env:            map[string]string{"TOOL_MODE": "test"},
		TimeoutMillis:  1000,
		MaxOutputBytes: 1024,
		GraceMillis:    100,
	}
}

func TestValidateInvocationFaultMatrix(t *testing.T) {
	tests := map[string]func(*invocationEnvelope){
		"empty command": func(value *invocationEnvelope) { value.Command = "" },
		"cwd escape":    func(value *invocationEnvelope) { value.Cwd = "/tmp" },
		"reserved env": func(value *invocationEnvelope) {
			value.Env = map[string]string{"LD_PRELOAD": "blocked"}
		},
		"bad env name": func(value *invocationEnvelope) {
			value.Env = map[string]string{"BAD-NAME": "blocked"}
		},
		"timeout over maximum": func(value *invocationEnvelope) {
			value.TimeoutMillis = maxTimeoutMillis + 1
		},
		"output over maximum": func(value *invocationEnvelope) {
			value.MaxOutputBytes = maxOutputBytes + 1
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			value := validTestEnvelope()
			mutate(&value)
			if validateInvocation(&value) == nil {
				t.Fatal("expected validation failure")
			}
		})
	}
	if err := validateInvocation(func() *invocationEnvelope {
		value := validTestEnvelope()
		return &value
	}()); err != nil {
		t.Fatalf("valid envelope rejected: %v", err)
	}
}

func TestWorkspaceComponentsFaultMatrix(t *testing.T) {
	for _, path := range []string{"", "/absolute", "../escape", "a/../b", "a//b", "a/./b"} {
		t.Run(path, func(t *testing.T) {
			if _, err := workspaceComponents(path); err == nil {
				t.Fatal("expected unsafe path rejection")
			}
		})
	}
	components, err := workspaceComponents("safe/nested/file")
	if err != nil || strings.Join(components, "/") != "safe/nested/file" {
		t.Fatalf("valid path rejected: %v", err)
	}
}

func TestDecodeStrictJSONRejectsUnknownAndTrailingInput(t *testing.T) {
	var envelope invocationEnvelope
	if err := decodeStrictJSON([]byte(`{"version":1,"unknown":true}`), &envelope); err == nil {
		t.Fatal("expected unknown field rejection")
	}
	if err := decodeStrictJSON([]byte(`{} {}`), &envelope); err == nil {
		t.Fatal("expected trailing JSON rejection")
	}
}

func TestBoundedOutputCapsCombinedStreams(t *testing.T) {
	output := &boundedOutput{remaining: 4}
	_, _ = (streamWriter{output: output}).Write([]byte("abc"))
	_, _ = (streamWriter{output: output, stderr: true}).Write([]byte("def"))
	if output.stdout.String() != "abc" || output.stderr.String() != "d" || !output.truncated {
		t.Fatal("combined output bound was not enforced")
	}
}

func TestBinaryTransferLimitFitsTheV1Base64Field(t *testing.T) {
	base64Characters := (maxBinaryTransferBytes + 2) / 3 * 4
	if base64Characters > maxTextTransferBytes {
		t.Fatalf("base64 length %d exceeds V1 field bound", base64Characters)
	}
}

func TestSupervisorPeerAuthorizationRejectsTenantAndQueuedDeadPeer(t *testing.T) {
	live := func(int32) bool { return true }
	dead := func(int32) bool { return false }
	trusted := &syscall.Ucred{Pid: 42, Uid: supervisorUID, Gid: supervisorGID}
	tenant := &syscall.Ucred{Pid: 43, Uid: tenantUID, Gid: tenantGID}

	if !authorizedSupervisorPeer(trusted, live) {
		t.Fatal("expected a live trusted helper to be authorized")
	}
	if authorizedSupervisorPeer(tenant, live) {
		t.Fatal("tenant-originated control connection was authorized")
	}
	if authorizedSupervisorPeer(tenant, dead) {
		t.Fatal("dead tenant peer was authorized")
	}
	if authorizedSupervisorPeer(trusted, dead) {
		t.Fatal("queued request from a dead trusted peer was authorized")
	}
	if authorizedSupervisorPeer(
		&syscall.Ucred{Pid: 1, Uid: supervisorUID, Gid: supervisorGID},
		live,
	) {
		t.Fatal("pid 1 self-connection was authorized")
	}
}

func TestTenantProcessAttributesDropSupervisorIdentity(t *testing.T) {
	attributes := tenantProcessAttributes()
	if attributes.Credential == nil ||
		attributes.Credential.Uid != tenantUID ||
		attributes.Credential.Gid != tenantGID ||
		attributes.Credential.Groups == nil ||
		len(attributes.Credential.Groups) != 0 {
		t.Fatal("tenant command does not drop to an isolated uid/gid")
	}
	if !attributes.Setpgid || attributes.Pdeathsig != syscall.SIGKILL {
		t.Fatal("tenant process cleanup attributes changed")
	}
}
