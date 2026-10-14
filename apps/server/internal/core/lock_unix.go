//go:build !windows

package core

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockShared(f *os.File) error    { return unix.Flock(int(f.Fd()), unix.LOCK_SH|unix.LOCK_NB) }
func lockExclusive(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
func unlockFile(f *os.File) error    { return unix.Flock(int(f.Fd()), unix.LOCK_UN) }
func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
