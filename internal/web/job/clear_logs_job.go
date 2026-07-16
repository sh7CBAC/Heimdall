package job

import (
	"os"

	"github.com/mhsanaei/3x-ui/v3/internal/logger"
	"github.com/mhsanaei/3x-ui/v3/internal/xray"
)

// ClearLogsJob clears old log files to prevent disk space issues.
type ClearLogsJob struct{}

// NewClearLogsJob creates a new log cleanup job instance.
func NewClearLogsJob() *ClearLogsJob {
	return new(ClearLogsJob)
}

// Here Run is an interface method of the Job interface.
func (j *ClearLogsJob) Run() {
	wipeAccessLog()
}

// wipeAccessLog truncates the user-configured Xray access log so it can't grow
// unbounded. The IP-limit job no longer reads or rotates it, so this daily wipe
// is the only thing that caps it. A disabled ("none") or unset access log is
// left alone, and a missing file is fine — there's nothing to wipe.
func wipeAccessLog() {
	accessLogPath, err := xray.GetAccessLogPath()
	if err != nil || accessLogPath == "none" || accessLogPath == "" {
		return
	}
	if err := os.Truncate(accessLogPath, 0); err != nil && !os.IsNotExist(err) {
		logger.Warning("Failed to truncate access log:", accessLogPath, "-", err)
	}
}
