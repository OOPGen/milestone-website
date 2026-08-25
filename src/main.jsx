import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './react-shell.css';
import legacyMarkup from './legacyMarkup';

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
