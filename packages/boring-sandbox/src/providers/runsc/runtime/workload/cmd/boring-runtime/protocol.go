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
	request := []byte(`{"version":1,"control":"baseline","command":"","cwd":"","env":{},"timeoutMs":1,"maxOutputBytes":1,"graceMs":2000}`)
	response, err := supervisorRequest(request)
	zero(request)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(response)
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

func unixPeerPID(connection net.Conn) (int32, error) {
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		return 0, errors.New("not a unix connection")
	}
	raw, err := unixConnection.SyscallConn()
	if err != nil {
		return 0, err
	}
	var credential *syscall.Ucred
	var socketErr error
	if err := raw.Control(func(fd uintptr) {
		credential, socketErr = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	}); err != nil {
		return 0, err
	}
	if socketErr != nil {
		return 0, socketErr
	}
	return credential.Pid, nil
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
