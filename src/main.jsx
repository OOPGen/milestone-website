import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './react-shell.css';
import legacyMarkup from './legacyMarkup';
import {contact} from './siteConfig.js';

// Expose the single source of truth to app.js (a classic script, so it cannot
// import the module directly). Set before app.js is appended.
window.SITE = contact;

function App(){
  const shell=useRef(null);
  useEffect(()=>{
    const script=document.createElement('script'); script.src='/app.js'; script.defer=true;
    document.body.appendChild(script);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
    return()=>script.remove();
  },[]);
  return <div ref={shell} className="react-app-shell" dangerouslySetInnerHTML={{__html:legacyMarkup}}/>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
