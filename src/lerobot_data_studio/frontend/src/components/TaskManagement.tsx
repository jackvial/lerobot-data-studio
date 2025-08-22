import React, { useState } from 'react';
import {
  Input,
  Button,
  Space,
  Tag,
  Typography,
  Tooltip,
  message,
  Card,
} from 'antd';
import { PlusOutlined, TagsOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface TaskManagementProps {
  availableTasks: string[];
  onAddTask: (task: string) => void;
  onRemoveTask: (task: string) => void;
}

const TaskManagement: React.FC<TaskManagementProps> = ({
  availableTasks,
  onAddTask,
  onRemoveTask,
}) => {
  const [newTask, setNewTask] = useState('');

  const handleAddTask = () => {
    const trimmedTask = newTask.trim();
    if (!trimmedTask) {
      return;
    }

    if (availableTasks.includes(trimmedTask)) {
      message.warning('Task already exists');
      return;
    }

    onAddTask(trimmedTask);
    setNewTask('');
    message.success(`Task "${trimmedTask}" added`);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTask();
    }
  };

  const handleRemoveTask = (task: string) => {
    onRemoveTask(task);
    message.info(`Task "${task}" removed`);
  };

  return (
    <Card
      title={
        <Space size='small'>
          <TagsOutlined style={{ color: '#1890ff' }} />
          <span>Task</span>
          {availableTasks.length > 0 && (
            <Tag
              color='blue'
              style={{
                margin: 0,
                fontSize: '11px',
                padding: '0 6px',
                height: '18px',
                lineHeight: '18px',
              }}
            >
              {availableTasks.length}{' '}
              {availableTasks.length === 1 ? 'task' : 'tasks'}
            </Tag>
          )}
        </Space>
      }
      size='small'
      style={{ marginBottom: '16px' }}
    >
      <Space direction='vertical' size='small' style={{ width: '100%' }}>
        <Space.Compact style={{ width: '100%' }} size='small'>
          <Input
            placeholder='Enter task name...'
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyPress={handleKeyPress}
            size='small'
          />
          <Button
            type='primary'
            icon={<PlusOutlined />}
            onClick={handleAddTask}
            disabled={!newTask.trim()}
            size='small'
            style={{ minWidth: '60px' }}
          >
            Add
          </Button>
        </Space.Compact>

        {availableTasks.length > 0 ? (
          <div>
            <Text
              type='secondary'
              style={{
                fontSize: '12px',
                display: 'block',
                marginBottom: '8px',
              }}
            >
              Available tasks (click to remove):
            </Text>
            <Space size={[4, 4]} wrap>
              {availableTasks.map((task, index) => (
                <Tooltip
                  key={task}
                  title={
                    index === 0
                      ? 'Default task (click to remove)'
                      : 'Click to remove'
                  }
                >
                  <Tag
                    closable
                    onClose={() => handleRemoveTask(task)}
                    color={index === 0 ? 'blue' : 'default'}
                    style={{
                      marginBottom: 0,
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '2px 8px',
                      height: '24px',
                      lineHeight: '20px',
                    }}
                  >
                    {task}
                    {index === 0 && (
                      <span
                        style={{
                          fontSize: '10px',
                          marginLeft: '4px',
                          opacity: 0.7,
                        }}
                      >
                        (default)
                      </span>
                    )}
                  </Tag>
                </Tooltip>
              ))}
            </Space>
          </div>
        ) : (
          <Text
            type='secondary'
            style={{ fontSize: '12px', fontStyle: 'italic' }}
          >
            No tasks defined yet. Add tasks above to assign them to episodes.
          </Text>
        )}
      </Space>
    </Card>
  );
};

export default TaskManagement;
