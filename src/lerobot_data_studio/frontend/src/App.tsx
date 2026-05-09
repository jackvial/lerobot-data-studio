import { Routes, Route } from 'react-router-dom';
import { Layout } from 'antd';
import HomePage from './components/HomePage';
import DatasetViewer from './components/DatasetViewer';
import RltBufferHome from './components/RltBufferHome';
import RltBufferViewer from './components/RltBufferViewer';

const { Content } = Layout;

function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rlt-buffer" element={<RltBufferHome />} />
          <Route path="/rlt-buffer/:fileToken" element={<RltBufferViewer />} />
          <Route
            path="/rlt-buffer/:fileToken/episode/:episodeId"
            element={<RltBufferViewer />}
          />
          <Route path="/:namespace/:name" element={<DatasetViewer />} />
          <Route path="/:namespace/:name/episode/:episodeId" element={<DatasetViewer />} />
        </Routes>
      </Content>
    </Layout>
  );
}

export default App;
