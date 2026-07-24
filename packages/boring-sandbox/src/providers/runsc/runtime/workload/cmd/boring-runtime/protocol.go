package main

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"os"
	"syscall"
	"time"
)

const (
	invocationFrameMagic = "BRI1"
	credentialFrameMagic = "BRC1"
)

func forwardInvocation() error {
	request, err := readBounded(os.Stdin, maxEnvelopeBytes)
	if err != nil {
		return err
	}
	defer zero(request)
	response, err := supervisorRequest(request)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(response)
	return err
}

func requestBaseline() error {
	metadata := []byte(`{"version":1,"control":"baseline","command":"","cwd":"","timeoutMs":1,"maxOutputBytes":1,"graceMs":2000}`)
	request, err := encodeInvocationFrame(metadata, nil)
	zero(metadata)
	if err != nil {
		return err
	}
	response, err := supervisorRequest(request)
	zero(request)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(response)
	return err
}

func encodeInvocationFrame(metadata, credentials []byte) ([]byte, error) {
	if len(metadata) == 0 ||
		len(metadata)+len(credentials)+12 > maxEnvelopeBytes {
		return nil, errors.New("invalid invocation frame")
	}
	frame := make([]byte, 12+len(metadata)+len(credentials))
	copy(frame[:4], invocationFrameMagic)
	binary.BigEndian.PutUint32(frame[4:8], uint32(len(metadata)))
	binary.BigEndian.PutUint32(frame[8:12], uint32(len(credentials)))
	copy(frame[12:12+len(metadata)], metadata)
	copy(frame[12+len(metadata):], credentials)
	return frame, nil
}

func decodeInvocationFrame(frame []byte) ([]byte, []byte, error) {
	if len(frame) < 12 || string(frame[:4]) != invocationFrameMagic {
		return nil, nil, errors.New("invalid invocation frame")
	}
	metadataLength := int(binary.BigEndian.Uint32(frame[4:8]))
	credentialLength := int(binary.BigEndian.Uint32(frame[8:12]))
	if metadataLength <= 0 ||
		credentialLength < 0 ||
		12+metadataLength+credentialLength != len(frame) {
		return nil, nil, errors.New("invalid invocation frame lengths")
	}
	metadata := frame[12 : 12+metadataLength]
	credentials := frame[12+metadataLength:]
	if len(credentials) > 0 {
		if len(credentials) < 6 || string(credentials[:4]) != credentialFrameMagic {
			return nil, nil, errors.New("invalid credential frame")
		}
	}
	return metadata, credentials, nil
}

func credentialField(frame []byte, requestedName string) ([]byte, error) {
	if len(frame) < 6 || string(frame[:4]) != credentialFrameMagic {
		return nil, errors.New("invalid credential frame")
	}
	count := int(binary.BigEndian.Uint16(frame[4:6]))
	if count <= 0 || count > 16 {
		return nil, errors.New("invalid credential field count")
	}
	offset := 6
	seen := make(map[string]struct{}, count)
	var selected []byte
	for index := 0; index < count; index++ {
		if offset+6 > len(frame) {
			return nil, errors.New("truncated credential field")
		}
		nameLength := int(binary.BigEndian.Uint16(frame[offset : offset+2]))
		valueLength := int(binary.BigEndian.Uint32(frame[offset+2 : offset+6]))
		offset += 6
		if nameLength <= 0 ||
			nameLength > maxCredentialNameBytes ||
			valueLength < 0 ||
			valueLength > maxCredentialBytes ||
			offset+nameLength+valueLength > len(frame) {
			return nil, errors.New("invalid credential field")
		}
		name := string(frame[offset : offset+nameLength])
		offset += nameLength
		value := frame[offset : offset+valueLength]
		offset += valueLength
		if _, duplicate := seen[name]; duplicate {
			return nil, errors.New("duplicate credential field")
		}
		seen[name] = struct{}{}
		if name == requestedName {
			selected = value
		}
	}
	if offset != len(frame) || selected == nil {
		return nil, errors.New("credential field unavailable")
	}
	return selected, nil
}

func writeCredentialField(reader io.Reader, requestedName string) error {
	frame, err := readBounded(reader, maxCredentialFrameBytes)
	if err != nil {
		return err
	}
	defer zero(frame)
	value, err := credentialField(frame, requestedName)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(value)
	return err
}

func supervisorRequest(request []byte) ([]byte, error) {
	var connection net.Conn
	var err error
	for attempt := 0; attempt < 100; attempt++ {
		connection, err = net.Dial("unix", socketPath)
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	if err := writeFramed(connection, request); err != nil {
		return nil, err
	}
	return readBounded(connection, 8*1024*1024)
}

func unixPeerCredential(connection net.Conn) (*syscall.Ucred, error) {
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		return nil, errors.New("not a unix connection")
	}
	raw, err := unixConnection.SyscallConn()
	if err != nil {
		return nil, err
	}
	var credential *syscall.Ucred
	var socketErr error
	if err := raw.Control(func(fd uintptr) {
		credential, socketErr = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	}); err != nil {
		return nil, err
	}
	if socketErr != nil {
		return nil, socketErr
	}
	return credential, nil
}

func peerProcessAlive(pid int32) bool {
	err := syscall.Kill(int(pid), 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func authorizedSupervisorPeer(credential *syscall.Ucred, alive func(int32) bool) bool {
	return credential != nil &&
		credential.Pid > 1 &&
		credential.Uid == supervisorUID &&
		credential.Gid == supervisorGID &&
		alive(credential.Pid)
}

func writeFramed(writer io.Writer, value []byte) error {
	if len(value) == 0 || len(value) > maxEnvelopeBytes {
		return errors.New("invalid frame")
	}
	header := make([]byte, 4)
	binary.BigEndian.PutUint32(header, uint32(len(value)))
	if _, err := writer.Write(header); err != nil {
		return err
	}
	_, err := writer.Write(value)
	return err
}

func readFramed(reader io.Reader, maximum int) ([]byte, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return nil, err
	}
	size := int(binary.BigEndian.Uint32(header))
	if size <= 0 || size > maximum {
		return nil, errors.New("invalid frame size")
	}
	value := make([]byte, size)
	_, err := io.ReadFull(reader, value)
	return value, err
}

func readBounded(reader io.Reader, maximum int) ([]byte, error) {
	value, err := io.ReadAll(io.LimitReader(reader, int64(maximum+1)))
	if err != nil {
		return nil, err
	}
	if len(value) == 0 || len(value) > maximum {
		zero(value)
		return nil, errors.New("input exceeds bound")
	}
	return value, nil
}

func zero(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
