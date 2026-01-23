import * as React from 'react';
import { createRoutesFromElements, Route } from 'react-router-dom';
import App from './app/App';
import Home from './app/Home';
import Reports from './app/Reports';
import Assets from './app/Assets';

export const routes = createRoutesFromElements(
  <Route path="/" element={<App />}>
    <Route index element={<Home />} />
    <Route path="reports" element={<Reports />} />
    <Route path="assets" element={<Assets />} />
  </Route>,
);
