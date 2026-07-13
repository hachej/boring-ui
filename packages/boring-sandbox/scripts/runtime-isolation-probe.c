#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/ptrace.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static int denied_errno(void) {
  return errno == EACCES || errno == ENOENT || errno == EPERM || errno == ESRCH;
}

static int parse_pid(const char *value, pid_t *pid) {
  char *end = NULL;
  long parsed = strtol(value, &end, 10);
  if (value[0] == '\0' || *end != '\0' || parsed <= 1 || parsed > 1L << 30) return 64;
  *pid = (pid_t)parsed;
  return 0;
}

static int probe_proc(const char *value) {
  pid_t pid;
  char path[64];
  struct stat status;
  if (parse_pid(value, &pid) != 0) return 64;
  snprintf(path, sizeof(path), "/proc/%ld", (long)pid);
  if (stat(path, &status) == 0) return 20;
  return denied_errno() ? 0 : 21;
}

static int probe_signal(const char *value) {
  pid_t pid;
  if (parse_pid(value, &pid) != 0) return 64;
  if (kill(pid, 0) == 0) return 20;
  if (!denied_errno()) return 21;
  if (kill(pid, SIGTERM) == 0) return 20;
  return denied_errno() ? 0 : 21;
}

static int probe_ptrace(const char *value) {
  pid_t pid;
  if (parse_pid(value, &pid) != 0) return 64;
  if (ptrace(PTRACE_ATTACH, pid, NULL, NULL) == 0) {
    ptrace(PTRACE_DETACH, pid, NULL, NULL);
    return 20;
  }
  return denied_errno() ? 0 : 21;
}

static int probe_mount(void) {
  if (mkdir("/tmp/isolation-mount", 0700) != 0 && errno != EEXIST) return 21;
  if (mount("none", "/tmp/isolation-mount", "tmpfs", 0, "size=4096") == 0) {
    umount("/tmp/isolation-mount");
    return 20;
  }
  return errno == EPERM || errno == EACCES ? 0 : 21;
}

static int probe_device(void) {
  const char *paths[] = {"/dev/kvm", "/dev/mem"};
  for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); i++) {
    int fd = open(paths[i], O_RDWR | O_CLOEXEC);
    if (fd >= 0) {
      close(fd);
      return 20;
    }
    if (!denied_errno()) return 21;
  }
  return 0;
}

static int probe_escape(const char *canary_path) {
  char path[512];
  int written;
  if (canary_path[0] != '/' || strstr(canary_path, "..") != NULL) return 64;
  written = snprintf(path, sizeof(path), "/proc/1/root%s", canary_path);
  if (written < 0 || (size_t)written >= sizeof(path)) return 64;
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd >= 0) {
    close(fd);
    return 20;
  }
  return denied_errno() ? 0 : 21;
}

int main(int argc, char **argv) {
  if (argc < 2) return 64;
  if (strcmp(argv[1], "mount") == 0 && argc == 2) return probe_mount();
  if (strcmp(argv[1], "device") == 0 && argc == 2) return probe_device();
  if (argc != 3) return 64;
  if (strcmp(argv[1], "proc") == 0) return probe_proc(argv[2]);
  if (strcmp(argv[1], "signal") == 0) return probe_signal(argv[2]);
  if (strcmp(argv[1], "ptrace") == 0) return probe_ptrace(argv[2]);
  if (strcmp(argv[1], "escape") == 0) return probe_escape(argv[2]);
  return 64;
}
