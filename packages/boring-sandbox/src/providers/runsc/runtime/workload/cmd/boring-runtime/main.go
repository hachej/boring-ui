package main

import "os"

const (
	controlDirectory          = "/tmp/boring-runtime-control"
	socketPath                = controlDirectory + "/supervisor.sock"
	workspaceRoot             = "/workspace"
	supervisorUID             = 0
	supervisorGID             = 0
	tenantUID                 = 65532
	tenantGID                 = 65532
	maxEnvelopeBytes          = 512 * 1024
	maxWorkspaceEnvelopeBytes = 8 * 1024 * 1024
	maxTextTransferBytes      = 6 * 1024 * 1024
	maxBinaryTransferBytes    = maxTextTransferBytes / 4 * 3
	maxOutputBytes            = 4 * 1024 * 1024
	maxEnvEntries             = 128
	maxEnvValueBytes          = 64 * 1024
	maxCommandBytes           = 64 * 1024
	maxPathBytes              = 4 * 1024
	maxTimeoutMillis          = 15 * 60 * 1000
	maxGraceMillis            = 10 * 1000
	atRemoveDir               = 0x200

	prSetChildSubreaper = 36
	sysOpenat2          = 437
	oPath               = 0x200000
	resolveNoMagicLinks = 0x02
	resolveNoSymlinks   = 0x04
	resolveBeneath      = 0x08

	codePathUnsafe           = "REMOTE_WORKER_PATH_UNSAFE"
	codePrimitiveUnavailable = "REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE"
	codeQuotaExceeded        = "REMOTE_WORKER_QUOTA_EXCEEDED"
)

func main() {
	if len(os.Args) != 2 {
		os.Exit(64)
	}
	switch os.Args[1] {
	case "supervise":
		if err := supervise(); err != nil {
			os.Exit(70)
		}
	case "invoke":
		if err := forwardInvocation(); err != nil {
			os.Exit(70)
		}
	case "baseline":
		if err := requestBaseline(); err != nil {
			os.Exit(70)
		}
	case "workspace":
		workspaceMain()
	default:
		os.Exit(64)
	}
}
