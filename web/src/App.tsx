/**
 * The route table. Each page module is owned by one contractor; this file is
 * the only place they meet, so it stays deliberately thin.
 */
import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';

const Home            = lazy(() => import('./pages/Home'));
const CatalogList     = lazy(() => import('./pages/CatalogList'));
const RecordDetail    = lazy(() => import('./pages/RecordDetail'));
const RecordEdit      = lazy(() => import('./pages/RecordEdit'));
const BrowseIndex     = lazy(() => import('./pages/BrowseIndex'));
const MakerDetail     = lazy(() => import('./pages/MakerDetail'));
const SeriesDetail    = lazy(() => import('./pages/SeriesDetail'));
const PersonDetail    = lazy(() => import('./pages/PersonDetail'));
const CollectionList  = lazy(() => import('./pages/CollectionList'));
const CollectionItem  = lazy(() => import('./pages/CollectionItemDetail'));
const CollectionEdit  = lazy(() => import('./pages/CollectionItemEdit'));
const Dashboard       = lazy(() => import('./pages/Dashboard'));
const NotFound        = lazy(() => import('./pages/NotFound'));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<Spinner label="Setting the record on the mandrel" />}>
        <Routes>
          <Route path="/" element={<Home />} />

          {/* The master list and its wiki-style pages */}
          <Route path="/catalog" element={<CatalogList />} />
          <Route path="/catalog/:slug" element={<RecordDetail />} />
          <Route path="/catalog/:slug/edit" element={<RecordEdit />} />
          <Route path="/catalog/new" element={<RecordEdit />} />
          <Route path="/browse" element={<BrowseIndex />} />
          <Route path="/makers/:slug" element={<MakerDetail />} />
          <Route path="/series/:slug" element={<SeriesDetail />} />
          <Route path="/people/:slug" element={<PersonDetail />} />

          {/* The collector's own shelf */}
          <Route path="/collection" element={<CollectionList />} />
          <Route path="/collection/new" element={<CollectionEdit />} />
          <Route path="/collection/:id" element={<CollectionItem />} />
          <Route path="/collection/:id/edit" element={<CollectionEdit />} />
          <Route path="/shelf" element={<Navigate to="/collection" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
