"""Storage abstraction for file operations."""
from __future__ import annotations

import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class Storage(ABC):
    """Abstract storage interface.

    Implementations handle file I/O for different backends.
    All paths are relative to the workspace root.
    """

    @abstractmethod
    def list_dir(self, path: Path) -> list[dict[str, Any]]:
        """List directory contents.

        Returns list of dicts with: name, path, is_dir, size (optional)
        """
        ...

    @abstractmethod
    def read_file(self, path: Path) -> str:
        """Read file contents as string."""
        ...

    @abstractmethod
    def write_file(self, path: Path, content: str) -> None:
        """Write content to file. Creates parent directories if needed."""
        ...

    @abstractmethod
    def delete(self, path: Path) -> None:
        """Delete file or directory recursively."""
        ...

    @abstractmethod
    def rename(self, old_path: Path, new_path: Path) -> None:
        """Rename a file or directory."""
        ...

    @abstractmethod
    def move(self, src_path: Path, dest_dir: Path) -> Path:
        """Move a file to a different directory. Returns new path."""
        ...

    @abstractmethod
    def exists(self, path: Path) -> bool:
        """Check if path exists."""
        ...


class LocalStorage(Storage):
    """Local filesystem storage implementation."""

    def __init__(self, root: Path):
        """Initialize with workspace root directory.

        Args:
            root: The root directory for all file operations
        """
        self.root = Path(root).resolve()

    def _abs(self, path: Path | str) -> Path:
        """Convert relative path to absolute, validating it's within root.

        Raises:
            ValueError: If path escapes the root directory
        """
        from .workspace.paths import resolve_path_beneath

        return resolve_path_beneath(self.root, path)

    def list_dir(self, path: Path) -> list[dict[str, Any]]:
        base = self._abs(path)
        entries = []
        try:
            for child in base.iterdir():
                entry = {
                    'name': child.name,
                    'path': str(child.relative_to(self.root)),
                    'is_dir': child.is_dir(),
                }
                if child.is_file():
                    try:
                        entry['size'] = child.stat().st_size
                    except OSError:
                        entry['size'] = 0
                entries.append(entry)
        except FileNotFoundError:
            return []
        # Sort: directories first, then alphabetically by name (case-insensitive)
        return sorted(entries, key=lambda e: (not e['is_dir'], e['name'].lower()))

    def read_file(self, path: Path) -> str:
        p = self._abs(path)
        with open(p, 'r', encoding='utf-8') as f:
            return f.read()

    def write_file(self, path: Path, content: str) -> None:
        p = self._abs(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(content)

    def delete(self, path: Path) -> None:
        p = self._abs(path)
        if not p.exists():
            raise FileNotFoundError(f'Path not found: {path}')
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()

    def rename(self, old_path: Path, new_path: Path) -> None:
        old_p = self._abs(old_path)
        new_p = self._abs(new_path)
        if not old_p.exists():
            raise FileNotFoundError(f'Path not found: {old_path}')
        if new_p.exists():
            raise FileExistsError(f'Path already exists: {new_path}')
        old_p.rename(new_p)

    def move(self, src_path: Path, dest_dir: Path) -> Path:
        src_p = self._abs(src_path)
        dest_d = self._abs(dest_dir)
        if not src_p.exists():
            raise FileNotFoundError(f'Source not found: {src_path}')
        if not dest_d.is_dir():
            raise NotADirectoryError(f'Destination is not a directory: {dest_dir}')
        dest_p = dest_d / src_p.name
        if dest_p.exists():
            raise FileExistsError(
                f'Destination already exists: {dest_p.relative_to(self.root)}'
            )
        shutil.move(str(src_p), str(dest_p))
        return dest_p.relative_to(self.root)

    def exists(self, path: Path) -> bool:
        p = self._abs(path)
        return p.exists()


class S3Storage(Storage):
    """AWS S3 storage implementation.

    Requires s3fs package: pip install boring-ui[s3]
    """

    def __init__(self, bucket: str, prefix: str = ''):
        """Initialize S3 storage.

        Args:
            bucket: S3 bucket name
            prefix: Optional key prefix for all operations
        """
        try:
            import s3fs
            self.fs = s3fs.S3FileSystem(anon=False)
        except ImportError as e:
            raise RuntimeError(
                's3fs is required for S3 storage: pip install boring-ui[s3]'
            ) from e
        self.bucket = bucket
        self.prefix = prefix.strip('/')

    def _key(self, path: Path | str) -> str:
        """Convert path to S3 key."""
        key = '/'.join(filter(None, [self.prefix, str(path).lstrip('/')]))
        return f'{self.bucket}/{key}' if key else self.bucket

    def list_dir(self, path: Path) -> list[dict[str, Any]]:
        base = str(path).lstrip('/')
        prefix = '/'.join(filter(None, [self.prefix, base]))
        full_prefix = f'{self.bucket}/{prefix}' if prefix else self.bucket
        files = self.fs.ls(full_prefix)
        entries = []
        # Calculate the key prefix to strip from full paths
        strip_prefix = f'{self.bucket}/'
        if self.prefix:
            strip_prefix += f'{self.prefix}/'
        for f in files:
            name = f.split('/')[-1]
            is_dir = f.endswith('/')
            # Return relative path (strip bucket and configured prefix)
            rel_path = f[len(strip_prefix):] if f.startswith(strip_prefix) else f
            entries.append({'name': name, 'path': rel_path, 'is_dir': is_dir})
        return entries

    def read_file(self, path: Path) -> str:
        key = self._key(path)
        with self.fs.open(key, 'r') as f:
            return f.read()

    def write_file(self, path: Path, content: str) -> None:
        key = self._key(path)
        with self.fs.open(key, 'w') as f:
            f.write(content)

    def delete(self, path: Path) -> None:
        key = self._key(path)
        if not self.fs.exists(key):
            raise FileNotFoundError(f'Path not found: {path}')
        self.fs.rm(key, recursive=True)

    def rename(self, old_path: Path, new_path: Path) -> None:
        old_key = self._key(old_path)
        new_key = self._key(new_path)
        if not self.fs.exists(old_key):
            raise FileNotFoundError(f'Path not found: {old_path}')
        if self.fs.exists(new_key):
            raise FileExistsError(f'Path already exists: {new_path}')
        self.fs.mv(old_key, new_key)

    def move(self, src_path: Path, dest_dir: Path) -> Path:
        src_key = self._key(src_path)
        if not self.fs.exists(src_key):
            raise FileNotFoundError(f'Source not found: {src_path}')
        src_name = str(src_path).split('/')[-1]
        dest_path = Path(str(dest_dir).rstrip('/') + '/' + src_name)
        dest_key = self._key(dest_path)
        if self.fs.exists(dest_key):
            raise FileExistsError(f'Destination already exists: {dest_path}')
        self.fs.mv(src_key, dest_key)
        return dest_path

    def exists(self, path: Path) -> bool:
        try:
            key = self._key(path)
            return self.fs.exists(key)
        except Exception:
            return False
