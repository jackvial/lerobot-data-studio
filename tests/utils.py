import pandas as pd

def get_episode_file_df(dataset_root, episode_index):
    """Get the episode file as a pandas dataframe"""
    episode_file = dataset_root / "data" / "chunk-000" / f"episode_{episode_index:06d}.parquet"
    assert episode_file.exists()
    return pd.read_parquet(episode_file)