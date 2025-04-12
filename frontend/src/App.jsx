import { Route, Routes,  HashRouter } from "react-router-dom";
import React, { useEffect} from "react";
// import Home from "./pages/home.jsx";
// import Landing from "./pages/landing.jsx";
// import LandingPage from "./pages/landingv0.jsx";
import { _ready } from "./data/data";
import { usePromise } from "./data/hooks";
import { Champion } from "./pages/champions.jsx";
import ScrollToTop from "./components/ScrollTop.jsx";
import "./styles.css";
import { Theme, Spinner } from "@radix-ui/themes";
import { UserProvider } from "./context/usercontext.jsx";
import { Toaster } from "sonner";
import AppInterface from "./pages/appinterface.jsx";
function App() {
  const ready = usePromise(_ready);
  useEffect(() => {
  }, []);
  return (
    <>


        <HashRouter>
          <ScrollToTop />
          <UserProvider>
          <Toaster expand={true} position="top-right" theme="dark" toastOptions={{
                  style: {
                    background: '#1a1a1a',
                    padding: '15px',
                    border: "0.5px",
                    borderStyle: "solid",
                    borderColor: "#1e1e1e"
                  }
                }} />
          <Theme accentColor='iris' appearance='dark' >


            {ready ? (
              <>

                <Routes>

                  <Route path="/" element={<AppInterface />} />
                  <Route path="/home" element={<AppInterface />} />
                  {/* <Route path="/landing" element={<Home />} /> */}

                  <Route path="/champions/:champion" element={<Champion />} />

                </Routes>

              </>

            ) : (

              <div className="h-screen w-screen grid place-items-center">
                <div>
                  <Spinner size="3" ></Spinner>
                </div>
              </div>
            )}
                      </Theme>

          </UserProvider>
        </HashRouter>
    </>
  );

}

export default App;
