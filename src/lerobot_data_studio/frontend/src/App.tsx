import { Routes, Route } from 'react-router-dom';
import { Layout } from 'antd';
import HomePage from './components/HomePage';
import DatasetViewer from './components/DatasetViewer';
import MergeDatasets from './components/MergeDatasets';

const { Content } = Layout;

function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/merge" element={<MergeDatasets />} />
          <Route path="/:namespace/:name" element={<DatasetViewer />} />
          <Route path="/:namespace/:name/episode/:episodeId" element={<DatasetViewer />} />
        </Routes>
      </Content>
    </Layout>
  );
}

export default App; 