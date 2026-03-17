package git

import "fmt"

// GitBackendError is the base error for all git backend failures.
type GitBackendError struct {
	Op      string
	Message string
	Err     error
}

func NewGitBackendError(op string, message string, err error) *GitBackendError {
	return &GitBackendError{
		Op:      op,
		Message: message,
		Err:     err,
	}
}

func (e *GitBackendError) Error() string {
	if e == nil {
		return "<nil>"
	}
	switch {
	case e.Op != "" && e.Message != "":
		return fmt.Sprintf("%s: %s", e.Op, e.Message)
	case e.Message != "":
		return e.Message
	case e.Op != "":
		return e.Op
	case e.Err != nil:
		return e.Err.Error()
	default:
		return "git backend error"
	}
}

func (e *GitBackendError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *GitBackendError) Is(target error) bool {
	_, ok := target.(*GitBackendError)
	return ok
}

func (e *GitBackendError) As(target any) bool {
	ptr, ok := target.(**GitBackendError)
	if !ok {
		return false
	}
	*ptr = e
	return true
}

// GitCommandError is a git command execution failure.
type GitCommandError struct {
	*GitBackendError
	ExitCode int
	Stderr   string
}

func NewGitCommandError(op string, message string, exitCode int, stderr string, err error) *GitCommandError {
	return &GitCommandError{
		GitBackendError: NewGitBackendError(op, message, err),
		ExitCode:        exitCode,
		Stderr:          stderr,
	}
}

func (e *GitCommandError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.GitBackendError != nil {
		return e.GitBackendError.Error()
	}
	return "git command error"
}

func (e *GitCommandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.GitBackendError
}

func (e *GitCommandError) Is(target error) bool {
	_, ok := target.(*GitCommandError)
	return ok
}

func (e *GitCommandError) As(target any) bool {
	ptr, ok := target.(**GitCommandError)
	if !ok {
		return false
	}
	*ptr = e
	return true
}

// GitAuthError is an authentication or credential failure.
type GitAuthError struct {
	*GitBackendError
}

func NewGitAuthError(op string, message string, err error) *GitAuthError {
	return &GitAuthError{GitBackendError: NewGitBackendError(op, message, err)}
}

func (e *GitAuthError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.GitBackendError != nil {
		return e.GitBackendError.Error()
	}
	return "git auth error"
}

func (e *GitAuthError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.GitBackendError
}

func (e *GitAuthError) Is(target error) bool {
	_, ok := target.(*GitAuthError)
	return ok
}

func (e *GitAuthError) As(target any) bool {
	ptr, ok := target.(**GitAuthError)
	if !ok {
		return false
	}
	*ptr = e
	return true
}

// GitConflictError is a merge or rebase conflict.
type GitConflictError struct {
	*GitBackendError
}

func NewGitConflictError(op string, message string, err error) *GitConflictError {
	return &GitConflictError{GitBackendError: NewGitBackendError(op, message, err)}
}

func (e *GitConflictError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.GitBackendError != nil {
		return e.GitBackendError.Error()
	}
	return "git conflict error"
}

func (e *GitConflictError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.GitBackendError
}

func (e *GitConflictError) Is(target error) bool {
	_, ok := target.(*GitConflictError)
	return ok
}

func (e *GitConflictError) As(target any) bool {
	ptr, ok := target.(**GitConflictError)
	if !ok {
		return false
	}
	*ptr = e
	return true
}

// GitNotFoundError indicates a repo object or resource was not found.
type GitNotFoundError struct {
	*GitBackendError
}

func NewGitNotFoundError(op string, message string, err error) *GitNotFoundError {
	return &GitNotFoundError{GitBackendError: NewGitBackendError(op, message, err)}
}

func (e *GitNotFoundError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.GitBackendError != nil {
		return e.GitBackendError.Error()
	}
	return "git not found error"
}

func (e *GitNotFoundError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.GitBackendError
}

func (e *GitNotFoundError) Is(target error) bool {
	_, ok := target.(*GitNotFoundError)
	return ok
}

func (e *GitNotFoundError) As(target any) bool {
	ptr, ok := target.(**GitNotFoundError)
	if !ok {
		return false
	}
	*ptr = e
	return true
}
