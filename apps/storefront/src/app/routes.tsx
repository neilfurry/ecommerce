import { NotFound, RouteError } from '@marketplace/ui';
import type { RouteObject } from 'react-router';
import { StoreLayout } from '../layouts/store-layout';
import { HomePage } from '../pages/home-page';
import { StatusPage } from '../pages/status-page';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <StoreLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'status', element: <StatusPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
