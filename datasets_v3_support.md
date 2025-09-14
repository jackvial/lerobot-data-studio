# Plan to Update lerobot_data_studio for Dataset v3 Support

## Overview
This document outlines the plan to update `lerobot_data_studio` to support LeRobot datasets v3.0 format while maintaining backward compatibility with v2.1.

## 1. Core Data Model Changes

### 1.1 Replace `episode_data_index` with `meta.episodes`
**Files to update:**
- `backend/dataset_creator/utils.py`
- `backend/dataset_creator/dataset_creator.py`
- `backend/dataset_creator/filtered_dataset_creator.py`
- `backend/dataset_creator/merged_dataset_creator.py`

**Changes:**
- Replace `dataset.episode_data_index["from"][episode_index]` with `dataset.meta.episodes["dataset_from_index"][episode_index]`
- Replace `dataset.episode_data_index["to"][episode_index]` with `dataset.meta.episodes["dataset_to_index"][episode_index]`

### 1.2 Update metadata structure
**New structure uses:**
- `dataset.meta.episodes` (DataFrame) instead of `dataset.episode_data_index`
- `dataset.meta.info` for dataset information
- `dataset.meta.stats` for statistics
- `dataset.meta.tasks` (DataFrame) for task information

## 2. File Path Structure Updates

### 2.1 Update data file paths
- **Old:** `data/chunk-{chunk:03d}/episode_{episode:06d}.parquet`
- **New:** `data/chunk-{chunk:03d}/file-{file:03d}.parquet`

### 2.2 Update video file paths
- **Old:** `videos/chunk-{chunk:03d}/{camera}/episode_{episode:06d}.mp4`
- **New:** `videos/{camera}/chunk-{chunk:03d}/file-{file:03d}.mp4`

### 2.3 Update metadata paths
- **Old:** `meta/episodes.jsonl`, `meta/episode_stats.jsonl`, `meta/tasks.jsonl`
- **New:** `meta/episodes/chunk-{chunk:03d}/file-{file:03d}.parquet`, `meta/tasks.parquet`, `meta/stats.json`

## 3. Dataset Creator Updates

### 3.1 DatasetCreator base class
- Update `supported_dataset_versions` to include `["v2.1", "v3.0"]`
- Modify `write_metadata_files()` to support both JSON Lines (v2.1) and Parquet (v3.0) formats
- Update `copy_episode_videos()` to handle new video path structure
- Add version detection logic

### 3.2 MergedDatasetCreator
- Update to use `dataset.meta.episodes` DataFrame instead of `episode_data_index`
- Modify episode aggregation to work with DataFrame structure
- Update metadata handling for v3 format

### 3.3 FilteredDatasetCreator
- Update episode filtering to use DataFrame operations
- Modify index remapping for new structure

## 4. Metadata Access Pattern Changes

### 4.1 Episode metadata access
- **Old:** Dictionary-based access
- **New:** DataFrame-based access with columns:
  - `episode_index`
  - `tasks` (list)
  - `length`
  - `dataset_from_index`
  - `dataset_to_index`

### 4.2 Task metadata access
- **Old:** JSON Lines format
- **New:** DataFrame with `task_index` as values

## 5. Statistics Handling

### 5.1 Update stats structure
- **Old:** Per-episode stats in JSON Lines
- **New:** Aggregated stats in `meta/stats.json`
- Add per-episode stats support if needed

## 6. Backward Compatibility

### 6.1 Version detection
- Add function to detect dataset version
- Route to appropriate handlers based on version

### 6.2 Migration support
- Consider adding utility to convert v2.1 datasets to v3.0
- Maintain v2.1 support for existing datasets

## 7. Testing Updates

### 7.1 Update test fixtures
- Create v3.0 format test datasets
- Update existing tests to handle both versions

### 7.2 Add version-specific tests
- Test v2.1 compatibility
- Test v3.0 functionality
- Test version detection

## 8. Implementation Priority

### Phase 1 - Core Support (Critical)
- Update episode index access patterns
- Fix metadata access to use DataFrame
- Update file path generation

### Phase 2 - Full Feature Support
- Update dataset creators for v3
- Implement proper metadata writing
- Update video handling

### Phase 3 - Polish
- Add version detection
- Implement backward compatibility
- Update documentation

## 9. Key Code Changes Needed

```python
# Example changes in utils.py
def get_episode_data(dataset: LeRobotDataset, episode_index: int):
    # Old v2.1 way
    # from_idx = dataset.episode_data_index["from"][episode_index]
    # to_idx = dataset.episode_data_index["to"][episode_index]

    # New v3.0 way
    from_idx = dataset.meta.episodes["dataset_from_index"][episode_index]
    to_idx = dataset.meta.episodes["dataset_to_index"][episode_index]

    # Rest remains the same...
```

```python
# Version detection helper
def get_dataset_version(dataset: LeRobotDataset) -> str:
    """Detect dataset version based on available attributes."""
    if hasattr(dataset, 'meta') and hasattr(dataset.meta, 'episodes'):
        if isinstance(dataset.meta.episodes, pd.DataFrame):
            return "v3.0"
    if hasattr(dataset, 'episode_data_index'):
        return "v2.1"
    raise ValueError("Unknown dataset version")
```

```python
# Backward compatible episode data access
def get_episode_bounds(dataset: LeRobotDataset, episode_index: int) -> tuple[int, int]:
    """Get episode boundaries compatible with both v2.1 and v3.0."""
    version = get_dataset_version(dataset)

    if version == "v3.0":
        from_idx = dataset.meta.episodes["dataset_from_index"][episode_index]
        to_idx = dataset.meta.episodes["dataset_to_index"][episode_index]
    else:  # v2.1
        from_idx = dataset.episode_data_index["from"][episode_index]
        to_idx = dataset.episode_data_index["to"][episode_index]

    return from_idx, to_idx
```

## 10. Risk Mitigation

- Keep v2.1 support intact initially
- Add version detection before making breaking changes
- Test thoroughly with both dataset versions
- Consider feature flags for gradual rollout

## 11. Affected Components Summary

| Component | Priority | Complexity | Changes Required |
|-----------|----------|------------|------------------|
| Episode index access | High | Low | Update accessor methods |
| Metadata structure | High | Medium | DataFrame vs dict handling |
| File paths | Medium | Low | Update path templates |
| Dataset creators | Medium | High | Refactor for v3 structure |
| Video handling | Medium | Medium | New path structure |
| Statistics | Low | Low | JSON vs parquet format |
| Tests | High | Medium | Support both versions |

## 12. Migration Path

1. **Stage 1:** Add version detection and compatibility layer
2. **Stage 2:** Update core functionality to support v3.0
3. **Stage 3:** Maintain dual support for v2.1 and v3.0
4. **Stage 4:** Eventually deprecate v2.1 support (future)

## Notes

- The v3.0 format is optimized for large-scale datasets with better memory efficiency
- File-based chunking replaces episode-based files for better scalability
- DataFrame-based metadata provides more efficient querying
- Consider implementing lazy loading for large v3.0 datasets

This plan ensures a smooth transition to v3 support while maintaining backward compatibility with existing v2.1 datasets.