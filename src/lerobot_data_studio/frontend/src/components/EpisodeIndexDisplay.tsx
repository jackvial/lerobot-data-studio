import React from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

interface EpisodeIndexDisplayProps {
  currentEpisodeId: number;
  actualEpisodeIndex?: number | null;
}

/**
 * Visually sanity check indices
 */
const EpisodeIndexDisplay: React.FC<EpisodeIndexDisplayProps> = ({
  currentEpisodeId,
  actualEpisodeIndex,
}) => {
  const hasIndexMismatch =
    actualEpisodeIndex !== null && actualEpisodeIndex !== currentEpisodeId;

  return (
    <Text
      type={hasIndexMismatch ? 'warning' : 'secondary'}
      style={{
        fontSize: '12px',
        whiteSpace: 'nowrap',
        color: hasIndexMismatch ? '#faad14' : undefined,
      }}
    >
      {actualEpisodeIndex !== null ? (
        <>
          selected_episode_index={currentEpisodeId}, row_episode_index=
          {actualEpisodeIndex}
          {hasIndexMismatch && ' ⚠️'}
        </>
      ) : (
        <>selected_episode_index={currentEpisodeId}, content=loading...</>
      )}
    </Text>
  );
};

export default EpisodeIndexDisplay;
