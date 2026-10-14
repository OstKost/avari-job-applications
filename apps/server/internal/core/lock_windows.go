package core

import (
	"golang.org/x/sys/windows"
	"os"
)

func lockShared(f *os.File) error {
	return windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{})
}
func lockExclusive(f *os.File) error {
	if err := unlockFile(f); err != nil {
		return err
	}
	return windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_FAIL_IMMEDIATELY|windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &windows.Overlapped{})
}
func unlockFile(f *os.File) error {
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, &windows.Overlapped{})
}

// Windows does not support fsync on directory handles; the replacement file is
// flushed before os.Rename and all SQLite connections have been closed.
func syncDirectory(string) error { return nil }
