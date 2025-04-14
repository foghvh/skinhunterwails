import React, { useEffect } from 'react';
import { Button, Flex, Tooltip } from '@radix-ui/themes';
import { PlayIcon, PauseIcon, UpdateIcon } from '@radix-ui/react-icons';
import { toast } from 'sonner';
import useModStatus from '../data/hooks';
import { KillModTools, CheckModToolsRunning } from "../../wailsjs/go/main/App";

const ModOverlayButton = () => {
  const { status, isDisabled, toggleOverlay, logs, waitingForExit, setStatus } = useModStatus();

  // Periodically check if process is still running
  useEffect(() => {
    if (status === "running") {
      const checkInterval = setInterval(() => {
        CheckModToolsRunning()
          .then(isRunning => {
            if (!isRunning && status === "running") {
              // Process died unexpectedly
              setStatus("stopped");
              toast.error("Mod overlay process stopped unexpectedly");
              
              // Update global status
              if (window.updateGlobalStatus) {
                window.updateGlobalStatus("Process stopped unexpectedly");
              }
            }
          })
          .catch(console.error);
      }, 5000); // Check every 5 seconds
      
      return () => clearInterval(checkInterval);
    }
  }, [status, setStatus]);

  const handleToggleOverlay = async () => {
    try {
      if (status === "running") {
        // Use KillModTools directly for more reliable stopping
        const result = await KillModTools();
        if (result) {
          toast.success("Mod overlay stopped successfully");
        } else {
          toast.error("Failed to stop mod overlay");
        }
      } else {
        await toggleOverlay();
        toast.success("Mod overlay started successfully");
      }
    } catch (error) {
      toast.error(error.message || "Failed to toggle overlay");
    }
  };

  const getButtonContent = () => {
    if (waitingForExit) {
      return (
        <Flex align="center" gap="2">
          <UpdateIcon className="animate-spin" />
          Waiting...
        </Flex>
      );
    }
    
    switch (status) {
      case "running":
        return (
          <Flex align="center" gap="2">
            <PauseIcon />
            Stop
          </Flex>
        );
      case "stopped":
      case "idle":
        return (
          <Flex align="center" gap="2">
            <PlayIcon />
            Start
          </Flex>
        );
      case "exiting":
        return (
          <Flex align="center" gap="2">
            <UpdateIcon className="animate-spin" />
            Stopping...
          </Flex>
        );
      case "error":
        return (
          <Flex align="center" gap="2" className="text-red-500">
            <PlayIcon />
            Restart
          </Flex>
        );
      default:
        return (
          <Flex align="center" gap="2">
            <PlayIcon />
            Toggle
          </Flex>
        );
    }
  };

  const getButtonColor = () => {
    if (waitingForExit) return "yellow";
    
    switch (status) {
      case "error":
        return "red";
      case "running":
        return "green";
      case "exiting":
        return "yellow";
      default:
        return "gray";
    }
  };

  const getTooltipContent = () => {
    if (waitingForExit) return "Waiting for exit...";
    if (isDisabled) return "Please wait...";
    
    switch (status) {
      case "running":
        return "Click to stop the mod overlay";
      case "stopped":
      case "idle":
        return "Click to start the mod overlay";
      case "exiting":
        return "Overlay is shutting down...";
      case "error":
        return "An error occurred. Click to restart";
      default:
        return "Toggle mod overlay";
    }
  };

  const getLatestLogs = () => {
    if (!logs || logs.length === 0) return "No recent logs";
    return logs.slice(-3).map(log => `${log.timestamp}: ${log.message}`).join('\n');
  };

  return (
    <Tooltip content={
      <div>
        <div>{getTooltipContent()}</div>
        {logs.length > 0 && (
          <div className="mt-2 text-xs opacity-75">
            Recent logs:
            <pre className="mt-1">{getLatestLogs()}</pre>
          </div>
        )}
      </div>
    }>
      <Button
        onClick={handleToggleOverlay}
        disabled={isDisabled || waitingForExit}
        color={getButtonColor()}
        className="w-fit mt-20"
        size="2"
      >
        {getButtonContent()}
      </Button>
    </Tooltip>
  );
};

export default ModOverlayButton;