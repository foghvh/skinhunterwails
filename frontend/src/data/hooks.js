import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { GetModStatus, SaveModStatus, StartRunOverlay, StopRunOverlay } from "../../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";

export function usePromise(p) {
  const [data, setData] = useState(null);
  useEffect(() => {
    p.then((value) => setData(value));
  });
  return data;
}

export function navigate(to) {
  window.location.hash = to;
  return null;
}

export function useTitle(title) {
  useEffect(() => {
    const oldTitle = document.title;
    document.title = `${title} · Skin Hunter`;
    return () => void (document.title = oldTitle);
  }, [title]);
}

export function useEscapeTo(url) {
  const navigate = useNavigate();
  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === "Escape") {
        navigate(url);
        e.preventDefault();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate, url]);
}

export function useLocalStorageState(name, initialValue) {
  const [value, _setValue] = useState(
    localStorage[name] ? JSON.parse(localStorage[name]) : initialValue
  );
  const setValue = (v) => {
    _setValue(v);
    localStorage[name] = JSON.stringify(v);
  };
  return [value, setValue];
}

export const useModStatus = () => {
  const [status, setStatus] = useState("idle");
  const [isDisabled, setIsDisabled] = useState(false);
  const [logs, setLogs] = useState([]);
  const [waitingForExit, setWaitingForExit] = useState(false);
  const [currentStatusMessage, setCurrentStatusMessage] = useState("Waiting...");

  // Reset status on component mount
  useEffect(() => {
    // Reset mod status on startup
    SaveModStatus({ status: "idle", isDisabled: false })
      .then(() => {
        setStatus("idle");
        setIsDisabled(false);
        setWaitingForExit(false);
        
        // Update global status
        if (window.updateGlobalStatus) {
          window.updateGlobalStatus("Ready to start");
        }
      })
      .catch(console.error);
      
    // Check if mod-tools is actually running
    GetModStatus()
      .then(savedStatus => {
        if (savedStatus && savedStatus.status === "running") {
          // Verify if process is actually running
          CheckModToolsRunning()
            .then(isRunning => {
              if (!isRunning) {
                // Process not running but status says it is - reset
                SaveModStatus({ status: "idle", isDisabled: false });
                setStatus("idle");
              }
            })
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const handleOverlayStarted = (data) => {
      console.log("Overlay started event received:", data);
      setStatus("running");
      setIsDisabled(false);
      setWaitingForExit(false);
      setCurrentStatusMessage("Waiting for league match to start");
      SaveModStatus({ status: "running", isDisabled: false });
      
      // Update global status for AppInterface
      if (window.updateGlobalStatus) {
        window.updateGlobalStatus("Waiting for league match to start");
      }
    };

    const handleOverlayStopped = (data) => {
      console.log("Overlay stopped event received:", data);
      setStatus(data.exitError ? "error" : "stopped");
      setIsDisabled(false);
      setWaitingForExit(false);
      setCurrentStatusMessage(data.exitError ? "Error occurred" : "Stopped");
      SaveModStatus({ 
        status: data.exitError ? "error" : "stopped", 
        isDisabled: false 
      });
      
      // Update global status for AppInterface
      if (window.updateGlobalStatus) {
        window.updateGlobalStatus(data.exitError ? "Error occurred" : "Stopped");
      }
    };

    const handleStdoutUpdate = (data) => {
      setLogs((prev) => [
        ...prev,
        {
          type: "stdout",
          message: data.content,
          timestamp: data.time,
          id: Date.now(),
        },
      ]);
      
      // Check for waiting for exit message
      if (data.content.includes("Waiting for exit")) {
        setWaitingForExit(true);
        setCurrentStatusMessage("Waiting for exit");
        
        // Update global status for AppInterface
        if (window.updateGlobalStatus) {
          window.updateGlobalStatus("Waiting for exit");
        }
      }
      
      // Check for waiting for league match message
      if (data.content.includes("Waiting for league match to start")) {
        setWaitingForExit(false);
        setCurrentStatusMessage("Waiting for league match to start");
        
        // Update global status for AppInterface
        if (window.updateGlobalStatus) {
          window.updateGlobalStatus("Waiting for league match to start");
        }
      }
      
      // Update global status for AppInterface with any message
      if (window.updateGlobalStatus) {
        window.updateGlobalStatus(data.content);
      }
    };

    const handleStderrUpdate = (data) => {
      setLogs((prev) => [
        ...prev,
        {
          type: "stderr",
          message: data.content,
          timestamp: data.time,
          id: Date.now(),
        },
      ]);
      if (data.content.toLowerCase().includes("error")) {
        setStatus("error");
        SaveModStatus({ status: "error", isDisabled: false }).catch(console.error);
      }
    };

    // Register all event listeners
    EventsOn("overlay-started", handleOverlayStarted);
    EventsOn("overlay-stopped", handleOverlayStopped);
    EventsOn("overlay-stdout-update", handleStdoutUpdate);
    EventsOn("overlay-stderr-update", handleStderrUpdate);

    // Cleanup function
    return () => {
      EventsOff("overlay-started");
      EventsOff("overlay-stopped");
      EventsOff("overlay-stdout-update");
      EventsOff("overlay-stderr-update");
    };
  }, []); // Remove status dependency to avoid redeclaration issues

    const toggleOverlay = async () => {
      setIsDisabled(true);
      const currentState = status; // Capture state at start of operation
      try {
        // If stopped, idle, or error -> try starting
        if (currentState === "stopped" || currentState === "idle" || currentState === "error") {
          console.log("Attempting to start overlay...");
          const result = await StartRunOverlay(); // StartOverlay now handles cleanup if necessary
          if (!result.success && result.message !== "Overlay is already running") { // Allow "already running" as success
            throw new Error(result.error || "Failed to start overlay");
          }
           // Event 'overlay-started' should update the status to 'running'
        }
        // If running -> try stopping
        else if (currentState === "running") {
          console.log("Attempting to stop overlay...");
          const result = await StopRunOverlay();
          if (!result.success) {
            throw new Error(result.error || "Failed to stop overlay");
          }
           // Event 'overlay-stopped' should update the status
        }
        // Add handling for 'exiting' state if needed, perhaps do nothing or wait.
        else if (currentState === 'exiting') {
            console.log("Overlay is already stopping, please wait.");
            // Optionally re-enable button after a delay or rely on events
        }

      } catch (error) {
        console.error("Error toggling overlay:", error);
        // Set status to error on failure, event listener might override this shortly if stop succeeds anyway
        setStatus("error");
        SaveModStatus({ status: "error", isDisabled: false }).catch(console.error);
        // No need to manually re-enable button here because of finally block
        toast.error(error.message || "Failed to toggle overlay"); // Show toast on error
        // Re-throw the error if needed by calling component, but toast is usually sufficient
        // throw error;
      } finally {
        // Re-enable button *unless* an operation successfully initiated start/stop
        // Rely on events 'overlay-started' and 'overlay-stopped' to set isDisabled = false
        // Let's keep it simple: always re-enable here, events will update state shortly after.
         setIsDisabled(false);
         // SaveModStatus({ status: status, isDisabled: false }).catch(console.error); // Maybe save status here too? Or rely on event handlers. Relying on events is cleaner.
      }
    };

    const clearLogs = () => setLogs([]);

    // Expose setStatus for external components
    const updateStatus = (newStatus) => {
      setStatus(newStatus);
      SaveModStatus({ status: newStatus, isDisabled: false })
        .catch(console.error);
    };

    return { 
    status, 
    isDisabled, 
    toggleOverlay, 
    logs, 
    clearLogs, 
    waitingForExit,
    currentStatusMessage,
    setStatus: updateStatus
  };
};

export default useModStatus;