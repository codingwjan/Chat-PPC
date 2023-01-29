import Login from './Login';
import App from './App';
import React from 'react';
import {BrowserRouter as Router, Navigate, Route, Routes} from "react-router-dom";

function Routing() {
    return (
        <React.StrictMode>
            <Router>
                <Routes>
                    <Route path="/" exact>
                        <Route path="/" element={<Navigate to={`/login`} replace/>}/>
                    < /Route>
                    <Route path="/login" element={<Login/>}/>
                    <Route path="/chat" element={<App/>}/>
                    <Route path="*" element={<Navigate to="/"/>}/>
                </Routes>
            </Router>
        </React.StrictMode>
    );
}

export default Routing;

