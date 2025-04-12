import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import React from 'react';
import App from './App.jsx'
import "./styles.css";
import { Theme } from "@radix-ui/themes";
// This is the ID of the div in your index.html file

const rootElement = document.getElementById('root');
const root = createRoot(rootElement);



root.render(
  <StrictMode>
    
      <App />
  </StrictMode>
  );