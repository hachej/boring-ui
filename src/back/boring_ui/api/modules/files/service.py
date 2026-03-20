"""File operations service for boring-ui API."""
import fnmatch
from pathlib import Path
from typing import Any
from fastapi import HTTPException

from ...config import APIConfig
from ...storage import Storage
from ...workspace.paths import resolve_path_beneath


class FileService:
    """Service class for file operations.
    
    Handles path validation, directory listing, file operations,
    and search functionality.
    """
    
    def __init__(self, config: APIConfig, storage: Storage):
        """Initialize the file service.
        
        Args:
            config: API configuration (for path validation)
            storage: Storage backend
        """
        self.config = config
        self.storage = storage
    
    def validate_and_relativize(self, path: str | Path) -> Path:
        """Validate path and return relative path.
        
        Args:
            path: Path to validate
            
        Returns:
            Path relative to workspace root
            
        Raises:
            HTTPException: If path is invalid or outside workspace
        """
        try:
            validated = resolve_path_beneath(self.config.workspace_root, Path(path))
            return validated.relative_to(self.config.workspace_root.resolve())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    
    def list_directory(self, path: str = '.') -> dict:
        """List directory contents.
        
        Args:
            path: Directory path relative to workspace root
            
        Returns:
            dict with entries list and path
        """
        rel_path = self.validate_and_relativize(path)
        entries = self.storage.list_dir(rel_path)
        return {'entries': entries, 'path': path}
    
    def read_file(self, path: str) -> dict:
        """Read file contents.
        
        Args:
            path: File path relative to workspace root
            
        Returns:
            dict with content string and path
            
        Raises:
            HTTPException: If file not found or is a directory
        """
        rel_path = self.validate_and_relativize(path)
        try:
            content = self.storage.read_file(rel_path)
            return {'content': content, 'path': path}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f'File not found: {path}')
        except IsADirectoryError:
            raise HTTPException(status_code=400, detail=f'Path is a directory: {path}')
    
    def write_file(self, path: str, content: str) -> dict:
        """Write file contents.
        
        Args:
            path: File path relative to workspace root
            content: Content to write
            
        Returns:
            dict with success status and path
            
        Raises:
            HTTPException: If write fails
        """
        rel_path = self.validate_and_relativize(path)
        try:
            self.storage.write_file(rel_path, content)
            return {'success': True, 'path': path}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'Write failed: {str(e)}')
    
    def delete_file(self, path: str) -> dict:
        """Delete file.
        
        Args:
            path: File path relative to workspace root
            
        Returns:
            dict with success status
            
        Raises:
            HTTPException: If file not found
        """
        rel_path = self.validate_and_relativize(path)
        try:
            self.storage.delete(rel_path)
            return {'success': True, 'path': path}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f'File not found: {path}')
    
    def rename_file(self, old_path: str, new_path: str) -> dict:
        """Rename file.
        
        Args:
            old_path: Current file path
            new_path: New file path
            
        Returns:
            dict with success status and paths
            
        Raises:
            HTTPException: If file not found or target exists
        """
        old_rel = self.validate_and_relativize(old_path)
        new_rel = self.validate_and_relativize(new_path)
        try:
            self.storage.rename(old_rel, new_rel)
            return {'success': True, 'old_path': old_path, 'new_path': new_path}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f'File not found: {old_path}')
        except FileExistsError:
            raise HTTPException(status_code=409, detail=f'Target exists: {new_path}')
    
    def move_file(self, src_path: str, dest_dir: str) -> dict:
        """Move file to a different directory.
        
        Args:
            src_path: Source file path
            dest_dir: Destination directory
            
        Returns:
            dict with success status and new path
            
        Raises:
            HTTPException: If file not found or destination invalid
        """
        src_rel = self.validate_and_relativize(src_path)
        dest_rel = self.validate_and_relativize(dest_dir)
        try:
            new_path = self.storage.move(src_rel, dest_rel)
            return {'success': True, 'old_path': src_path, 'dest_path': str(new_path)}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f'File not found: {src_path}')
        except NotADirectoryError:
            raise HTTPException(status_code=400, detail=f'Destination is not a directory: {dest_dir}')
    
    def search_files(self, pattern: str, path: str = '.') -> dict:
        """Search files by name pattern.
        
        Uses glob-style pattern matching (e.g., *.py, test_*).
        
        Args:
            pattern: Search pattern
            path: Directory to search in
            
        Returns:
            dict with matches list
        """
        rel_path = self.validate_and_relativize(path)
        matches: list[dict[str, Any]] = []
        
        def search_recursive(dir_path: Path, depth: int = 0):
            """Recursively search directory."""
            if depth > 10:  # Prevent infinite recursion
                return
            
            try:
                entries = self.storage.list_dir(dir_path)
                for entry in entries:
                    entry_path = Path(entry['path'])
                    name = entry_path.name
                    
                    # Match against pattern
                    if fnmatch.fnmatch(name.lower(), pattern.lower()):
                        # Add 'dir' field (parent directory) for frontend compatibility
                        result = {
                            'name': entry['name'],
                            'path': entry['path'],
                            'dir': str(entry_path.parent) if str(entry_path.parent) != '.' else '',
                        }
                        matches.append(result)
                    
                    # Recurse into directories
                    if entry['is_dir']:
                        search_recursive(entry_path, depth + 1)
            except (FileNotFoundError, PermissionError):
                pass
        
        search_recursive(rel_path)
        return {'results': matches, 'pattern': pattern, 'path': path}
