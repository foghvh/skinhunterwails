package main

import (
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dgrijalva/jwt-go"
	storage "github.com/supabase-community/storage-go"
	"github.com/supabase-community/supabase-go"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/bcrypt"
)

func init() {
	// Pre-create the PowerShell command to load System.Windows.Forms
	loadFormsCmd := exec.Command("powershell", "-Command", "Add-Type -AssemblyName System.Windows.Forms")
	_ = loadFormsCmd.Run()
}

// App struct
type App struct {
	ctx             context.Context
	installedSkins  map[string]SkinInfo
	modToolsProcess *os.Process // Stores the process IF WE successfully started and are monitoring it
	modToolsPid     int         // Store PID separately for logging/killing even if Process object becomes invalid

	installedPath string
}

// SkinInfo representa la información de una skin instalada
type SkinInfo struct {
	SkinId     string `json:"skinId,string"`
	FileName   string `json:"fileName,string"`
	ProcessId  string `json:"processId,string"`
	ChromaName string `json:"chromaName"`
	SkinName   string `json:"skinName"`
	ImageUrl   string `json:"imageUrl"`
}

// Constantes de rutas
const (
	RelativeBasePath      = "resources"
	RelativeInstalledPath = "LoLModInstaller/installed"
	RelativeProfilesPath  = "LoLModInstaller/profiles/Default"
	RelativeModToolsDir   = "cslol-tools"
	ModToolsExeName       = "mod-tools.exe"
	RelativeModStatusFile = "LoLModInstaller/mod-status.json"
	GamePath              = "C:\\Riot Games\\League of Legends\\Game" // Asumimos que es fijo
)

// Variables de Supabase y JWT (ajusta según tu configuración)
const (
	SupabaseURL = "https://odlqwkgewzxxmbsqutja.supabase.co"
	SupabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kbHF3a2dld3p4eG1ic3F1dGphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQyMTM2NzcsImV4cCI6MjA0OTc4OTY3N30.qka6a71bavDeUQgy_BKoVavaClRQa_gT36Au7oO9AF0"
	JWTSecret   = "bian1212"
)

var (
	appCtx           context.Context // Para usar en helpers si es necesario
	absBasePath      string
	absModToolsPath  string
	absInstalledPath string
	absProfilesPath  string
	absModStatusPath string
	absGamePath      string = GamePath // GamePath ya es absoluto
)

var supabaseClient *supabase.Client

// NewApp crea una nueva instancia de la aplicación
func NewApp() *App {
	return &App{
		installedSkins: make(map[string]SkinInfo),
		installedPath:  absInstalledPath,
		modToolsPid:    0, // Initialize PID to 0

	}
}

// startup se llama al iniciar la aplicación
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	appCtx = ctx // Guardar globalmente si es necesario para logs fuera de 'a'
	modStatusData := map[string]interface{}{
		"status":     "idle",
		"isDisabled": false,
	}
	modStatusJson, _ := json.MarshalIndent(modStatusData, "", "  ")
	os.WriteFile(absModStatusPath, modStatusJson, 0644)
	var err error
	supabaseClient, err = supabase.NewClient(SupabaseURL, SupabaseKey, nil)
	if err != nil {
		panic(fmt.Sprintf("Failed to create Supabase client: %v", err))
	}

	// --- Determinar y Establecer Rutas Absolutas ---
	execDir := ""
	ex, err := os.Executable()
	if err != nil {
		wd, errWd := os.Getwd()
		if errWd != nil {
			panic(fmt.Sprintf("Failed to get executable path or working directory: %v / %v", err, errWd))
		}
		execDir = wd // Usar WD como fallback
		runtime.LogWarningf(ctx, "Could not get executable path (%v), using working directory %s", err, wd)
	} else {
		execDir = filepath.Dir(ex) // Directorio del ejecutable
	}

	absBasePath, err = filepath.Abs(filepath.Join(execDir, RelativeBasePath))
	if err != nil {
		panic(fmt.Sprintf("Failed to resolve absolute base path from %s + %s: %v", execDir, RelativeBasePath, err))
	}

	absModToolsPath = filepath.Join(absBasePath, RelativeModToolsDir, ModToolsExeName)
	absInstalledPath = filepath.Join(absBasePath, RelativeInstalledPath)
	absProfilesPath = filepath.Join(absBasePath, RelativeProfilesPath)
	absModStatusPath = filepath.Join(absBasePath, RelativeModStatusFile)

	runtime.LogInfof(ctx, "Absolute Base Path: %s", absBasePath)
	runtime.LogInfof(ctx, "Absolute ModTools Path: %s", absModToolsPath)
	runtime.LogInfof(ctx, "Absolute Installed Path: %s", absInstalledPath)
	runtime.LogInfof(ctx, "Absolute Profiles Path: %s", absProfilesPath)
	runtime.LogInfof(ctx, "Absolute ModStatus Path: %s", absModStatusPath)
	runtime.LogInfof(ctx, "Absolute Game Path: %s", absGamePath)
	// -----------------------------------------------

	// Usa las rutas absolutas para asegurar directorios
	if err := EnsureDirectoriesAbs([]string{absInstalledPath, absProfilesPath, filepath.Dir(absModStatusPath)}); err != nil {
		runtime.LogError(ctx, fmt.Sprintf("Failed to ensure directories exist: %v", err))
		// Considerar si es fatal
	}

	a.LoadInstalledSkins() // Ahora usa absInstalledPath internamente
	a.CleanupTempFiles()   // Ahora usa absInstalledPath internamente
}

// Helper para crear directorios (no necesita ser método de App)
func EnsureDirectoriesAbs(paths []string) error {
	for _, p := range paths {
		if err := os.MkdirAll(p, 0755); err != nil {
			runtime.LogError(appCtx, fmt.Sprintf("MkdirAll failed for %s: %v", p, err)) // Usa appCtx si es necesario
			return fmt.Errorf("failed to create directory %s: %w", p, err)
		}
	}
	return nil
}

// LoadInstalledSkins carga las skins instaladas desde installed.json
func (a *App) LoadInstalledSkins() error {
	installedJsonPathAbs := filepath.Join(absInstalledPath, "installed.json")
	runtime.LogInfof(a.ctx, "Loading installed skins from: %s", installedJsonPathAbs)
	data, err := os.ReadFile(installedJsonPathAbs)
	if err != nil {
		if os.IsNotExist(err) {
			a.installedSkins = make(map[string]SkinInfo)
			runtime.LogWarningf(a.ctx, "%s not found, initializing empty map.", installedJsonPathAbs)
			return nil // No es un error si no existe aún
		}
		return fmt.Errorf("error reading %s: %v", installedJsonPathAbs, err)
	}

	var installedSkinsArray []map[string]interface{}
	if err := json.Unmarshal(data, &installedSkinsArray); err != nil {
		return fmt.Errorf("error parsing installed.json: %v", err)
	}

	// Convertir el array a un mapa
	a.installedSkins = make(map[string]SkinInfo)
	for _, skinData := range installedSkinsArray {
		championId := skinData["championId"].(string)
		if championId == "" {
			continue
		}

		a.installedSkins[championId] = SkinInfo{
			SkinId:     skinData["skinId"].(string),
			FileName:   skinData["fileName"].(string),
			ProcessId:  skinData["processId"].(string),
			ChromaName: skinData["chromaName"].(string),
			SkinName:   skinData["skinName"].(string),
			ImageUrl:   skinData["imageUrl"].(string),
		}
	}

	return nil
}

// SaveInstalledSkins guarda las skins instaladas en installed.json
func (a *App) SaveInstalledSkins() error {
	var installedSkinsArray []map[string]interface{}
	for championId, skin := range a.installedSkins {
		if championId == "" {
			continue
		} // Buena guarda
		installedSkinsArray = append(installedSkinsArray, map[string]interface{}{
			"championId": championId, /* ... otros campos ... */
			"skinId":     skin.SkinId,
			"fileName":   skin.FileName,
			"processId":  skin.ProcessId, // Considerar si aún es necesario
			"chromaName": skin.ChromaName,
			"skinName":   skin.SkinName,
			"imageUrl":   skin.ImageUrl,
		})
	}

	data, err := json.MarshalIndent(installedSkinsArray, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshaling installed skins: %v", err)
	}

	installedJsonPathAbs := filepath.Join(absInstalledPath, "installed.json")
	runtime.LogInfof(a.ctx, "Saving installed skins to: %s", installedJsonPathAbs)
	if err := os.WriteFile(installedJsonPathAbs, data, 0644); err != nil {
		return fmt.Errorf("error writing %s: %v", installedJsonPathAbs, err)
	}
	return nil
}

// KillModTools termina el proceso de mod-tools.exe y sus hijos
func (a *App) KillModTools() (bool, error) {
	runtime.LogInfo(a.ctx, "Attempting to gracefully stop mod-tools.exe")

	// First kill mod-tools.exe process
	modToolsKilled := false

	// Try to kill by PID first if we have it
	if a.modToolsPid != 0 {
		process, err := os.FindProcess(a.modToolsPid)
		if err == nil {
			if err := process.Kill(); err == nil {
				runtime.LogInfof(a.ctx, "Successfully killed mod-tools.exe with PID %d", a.modToolsPid)
				modToolsKilled = true
			}
		}
	}

	// If PID kill failed, try by name
	if !modToolsKilled {
		killCmd := exec.Command("taskkill", "/F", "/IM", "mod-tools.exe")
		if err := killCmd.Run(); err == nil {
			runtime.LogInfo(a.ctx, "Successfully killed mod-tools.exe by name")
			modToolsKilled = true
		}
	}

	// Now find and close any cmd windows running our batch file
	findCmdCmd := exec.Command("powershell", "-Command", "Get-Process | Where-Object {$_.ProcessName -eq 'cmd' -and $_.MainWindowTitle -like '*run_overlay*'} | Select-Object -ExpandProperty Id")
	output, err := findCmdCmd.Output()
	if err == nil && len(strings.TrimSpace(string(output))) > 0 {
		// Found cmd windows, kill them
		cmdPids := strings.Split(strings.TrimSpace(string(output)), "\r\n")
		for _, pid := range cmdPids {
			killCmdCmd := exec.Command("taskkill", "/F", "/PID", pid)
			if err := killCmdCmd.Run(); err == nil {
				runtime.LogInfof(a.ctx, "Successfully closed cmd window with PID %s", pid)
			} else {
				runtime.LogWarningf(a.ctx, "Failed to close cmd window with PID %s: %v", pid, err)
			}
		}
	}

	// Reset our process tracking
	a.modToolsProcess = nil
	a.modToolsPid = 0

	// Update mod status
	a.SaveModStatus(map[string]interface{}{
		"status":     "idle",
		"isDisabled": false,
	})

	// Emit event for frontend
	runtime.EventsEmit(a.ctx, "overlay-stopped", map[string]interface{}{
		"exitError": false,
		"message":   "Process stopped by user",
	})

	return true, nil
}

func (a *App) RunOverlay(args []string) map[string]interface{} {
	modToolsDir := filepath.Dir(absModToolsPath)

	// Create a batch file to keep the process running
	batchFilePath := filepath.Join(modToolsDir, "run_overlay.bat")
	batchContent := fmt.Sprintf("@echo off\r\ncd /d \"%s\"\r\n\"%s\" %s\r\npause\r\n",
		modToolsDir,
		absModToolsPath,
		strings.Join(args, " "))

	if err := os.WriteFile(batchFilePath, []byte(batchContent), 0644); err != nil {
		runtime.LogErrorf(a.ctx, "Failed to create batch file: %v", err)
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to create batch file: %v", err)}
	}

	// Start the batch file instead of direct command
	cmd := exec.Command("cmd.exe", "/C", "start", batchFilePath)
	cmd.Dir = modToolsDir

	// Use CREATE_NEW_CONSOLE flag
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000010, // CREATE_NEW_CONSOLE
	}

	// Start the process
	if err := cmd.Start(); err != nil {
		runtime.LogErrorf(a.ctx, "Failed to start batch file: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to start batch file: %v", err),
		}
	}

	// Wait a moment for the process to start
	time.Sleep(1 * time.Second)

	// Find the mod-tools.exe process
	cmdFind := exec.Command("tasklist", "/FI", "IMAGENAME eq mod-tools.exe", "/NH", "/FO", "CSV")
	output, err := cmdFind.Output()
	if err != nil || !strings.Contains(string(output), "mod-tools.exe") {
		runtime.LogErrorf(a.ctx, "Failed to find mod-tools.exe process: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to find mod-tools.exe process",
		}
	}

	// Extract PID from tasklist output
	csvReader := csv.NewReader(strings.NewReader(string(output)))
	records, err := csvReader.ReadAll()
	if err != nil || len(records) == 0 {
		runtime.LogErrorf(a.ctx, "Failed to parse tasklist output: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to parse tasklist output",
		}
	}

	pidStr := records[0][1]
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Failed to convert PID to integer: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to convert PID to integer",
		}
	}

	a.modToolsPid = pid
	runtime.LogInfof(a.ctx, "Found mod-tools.exe with PID: %d", pid)

	// Emit the started event
	runtime.EventsEmit(a.ctx, "overlay-started", map[string]interface{}{
		"pid":     a.modToolsPid,
		"message": "Overlay running and waiting for match",
	})

	return map[string]interface{}{
		"success": true,
		"pid":     a.modToolsPid,
		"message": "Overlay process started",
	}
}

func (a *App) StartRunOverlay() map[string]interface{} {
	runtime.LogInfo(a.ctx, "StartRunOverlay called.")
	// Reset mod status before starting
	a.SaveModStatus(map[string]interface{}{
		"status":     "idle",
		"isDisabled": false,
	})
	// --- Check if already running (using Signal 0) ---
	if a.modToolsPid != 0 {
		process, err := os.FindProcess(a.modToolsPid)
		if err == nil {
			errSignal := process.Signal(syscall.Signal(0))
			if errSignal == nil {
				runtime.LogInfof(a.ctx, "mod-tools.exe appears to be running with tracked PID %d", a.modToolsPid)
				// Check if it's actually mod-tools.exe (optional, but good)
				// Tasklist check here can add confidence, but Signal(0) is the primary check now.
				// cmdCheck := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", a.modToolsPid), "/NH")
				// outputCheck, errCheck := cmdCheck.Output()
				// if errCheck == nil && strings.Contains(strings.ToLower(string(outputCheck)), "mod-tools.exe") { ... }

				return map[string]interface{}{
					"success": true, // Already running is considered success
					"message": "Overlay is already running",
					"pid":     a.modToolsPid,
				}
			}
			// Signal failed, clear state
			runtime.LogWarningf(a.ctx, "Signal check failed for PID %d: %v. Assuming process is gone.", a.modToolsPid, errSignal)
			a.modToolsProcess = nil
			a.modToolsPid = 0
		} else {
			// FindProcess failed, clear state
			runtime.LogWarningf(a.ctx, "os.FindProcess failed for PID %d: %v", a.modToolsPid, err)
			a.modToolsProcess = nil
			a.modToolsPid = 0
		}
	}
	// ---------------------------------------------

	// --- Check for Orphans (taskkill is fine here) ---
	cmdTasklist := exec.Command("tasklist", "/FI", "IMAGENAME eq mod-tools.exe", "/NH")
	output, err := cmdTasklist.Output()
	if err == nil && strings.Contains(strings.ToLower(string(output)), "mod-tools.exe") {
		runtime.LogWarningf(a.ctx, "Found an orphaned mod-tools.exe process (not tracked by PID). Killing it...")
		if killed, killErr := a.KillModTools(); !killed {
			runtime.LogErrorf(a.ctx, "Failed to kill orphaned mod-tools.exe: %v", killErr)
			// Consider if this should prevent startup
		} else {
			runtime.LogInfo(a.ctx, "Orphaned mod-tools.exe process killed.")
			time.Sleep(200 * time.Millisecond) // Give OS a moment
		}
	}
	// ---------------------------------------------

	// Build arguments (ensure absolute paths are used from startup)
	args := []string{
		"runoverlay",
		absProfilesPath,
		"--game:" + absGamePath,
		"configless",
	}

	// Start the process using the revised RunOverlay (which now uses pipes)
	// RunOverlay itself returns immediately, success/failure determined by monitor events
	return a.RunOverlay(args)
}

// --- Adjust StopRunOverlay ---
// KillModTools already tries to kill by name, which is robust.
// The check before killing can use the Signal(0) method too.
func (a *App) StopRunOverlay() map[string]interface{} {
	runtime.LogInfo(a.ctx, "StopRunOverlay called.")

	pidToStop := a.modToolsPid // Store pid in case KillModTools clears it

	if pidToStop == 0 {
		runtime.LogInfo(a.ctx, "No tracked process PID. Attempting kill by name.")
		// KillModTools handles killing by name if PID is 0 or the process object is nil
	} else {
		runtime.LogInfof(a.ctx, "Attempting to stop process with tracked PID %d", pidToStop)
		// Find the process first to ensure it exists before trying taskkill by name?
		// Optional: Add a direct kill by PID first
		// process, err := os.FindProcess(pidToStop)
		// if err == nil {
		//     runtime.LogInfof(a.ctx, "Attempting direct kill for PID %d", pidToStop)
		//     errKill := process.Kill()
		//     if errKill == nil {
		//          runtime.LogInfof(a.ctx, "Successfully sent kill signal to PID %d", pidToStop)
		//          // Wait a moment or rely on monitor to clear state
		//          time.Sleep(100 * time.Millisecond) // Give it a moment
		//          // Check if it's gone? Or just proceed to kill-by-name as fallback?
		//          // For simplicity, we can let KillModTools handle the final confirmation / cleanup.
		//     } else {
		//          runtime.LogWarningf(a.ctx, "Direct kill signal failed for PID %d: %v. Falling back to taskkill.", pidToStop, errKill)
		//     }
		// }
	}

	// Always attempt KillModTools (by name) as it's a good cleanup step
	killed, err := a.KillModTools() // This function attempts taskkill /IM

	if !killed {
		errMsg := fmt.Sprintf("Failed to confirm mod-tools.exe termination")
		if pidToStop != 0 {
			errMsg = fmt.Sprintf("Failed to confirm termination of process PID %d", pidToStop)
		}
		if err != nil {
			errMsg += fmt.Sprintf(": %v", err)
		}
		runtime.LogErrorf(a.ctx, errMsg)
		return map[string]interface{}{
			"success": false,
			"error":   errMsg,
		}
	}

	// KillModTools should have reset a.modToolsPid if successful
	finalMsg := "Successfully stopped mod-tools.exe (killed by name)."
	if pidToStop != 0 {
		finalMsg = fmt.Sprintf("Successfully stopped process formerly tracked as PID %d (killed by name).", pidToStop)
	}

	runtime.LogInfof(a.ctx, finalMsg)
	return map[string]interface{}{
		"success": true,
		"message": finalMsg,
	}
}

func (a *App) CheckModToolsRunning() bool {
	// If we have a tracked PID, check if it's still running
	if a.modToolsPid != 0 {
		process, err := os.FindProcess(a.modToolsPid)
		if err == nil {
			errSignal := process.Signal(syscall.Signal(0))
			if errSignal == nil {
				// Process exists and we can signal it
				return true
			}
		}
	}

	// Check if any mod-tools.exe is running using tasklist
	cmd := exec.Command("tasklist", "/FI", "IMAGENAME eq mod-tools.exe", "/NH")
	output, err := cmd.Output()
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error checking if mod-tools.exe is running: %v", err)
		return false
	}

	return strings.Contains(string(output), "mod-tools.exe")
}

// --- Nuevo Monitor para leer de Pipes ---
func (a *App) monitorOverlayProcessWithoutPipeReads(cmd *exec.Cmd) {
	pid := cmd.Process.Pid
	runtime.LogInfof(a.ctx, "Monitoring process with PID: %d (stdio inherited)", pid)
	a.modToolsProcess = cmd.Process

	// Emitir evento started
	runtime.EventsEmit(a.ctx, "overlay-started", map[string]interface{}{ /* ... */ })

	// Esperar a que el proceso termine
	waitErr := cmd.Wait()
	runtime.LogInfof(a.ctx, "Process PID %d finished. Wait() returned error: %v", pid, waitErr)

	// Procesar resultado y emitir evento stopped
	// ... (misma lógica que antes para exitError, errMsg, exitCode) ...
	runtime.EventsEmit(a.ctx, "overlay-stopped", map[string]interface{}{ /* ... */ })

	// Limpiar estado
	// ... (misma lógica que antes) ...
	runtime.LogInfof(a.ctx, "Exited monitoring loop for PID: %d", pid)
}

// monitorOverlayProcess monitors the mod-tools process, sends log updates, and manages state
func (a *App) monitorOverlayProcess(cmd *exec.Cmd, stdoutPipe, stderrPipe io.ReadCloser) {
	pid := cmd.Process.Pid
	runtime.LogInfof(a.ctx, "[Monitor PID %d] Started monitoring.", pid)

	var wg sync.WaitGroup
	wg.Add(2) // Wait for both stdout and stderr readers to finish

	// Channel to signal successful start based on stdout message
	startedSuccessfully := make(chan bool, 1)

	// --- Goroutine to read Stdout ---
	go func() {
		defer wg.Done()
		defer stdoutPipe.Close() // Close the pipe when done reading
		scanner := bufio.NewScanner(stdoutPipe)
		initialStartupPhase := true // Flag to check for the specific startup message
		runtime.LogInfof(a.ctx, "[Monitor PID %d] Reading stdout...", pid)
		for scanner.Scan() {
			line := scanner.Text()
			runtime.LogInfof(a.ctx, "[ModTools STDOUT PID %d]: %s", pid, line) // Log raw output

			// Check for the specific success message *only* during startup phase
			if initialStartupPhase && strings.Contains(line, "Status: Waiting for league match to start") {
				runtime.LogInfof(a.ctx, "[Monitor PID %d] Success message found!", pid)
				startedSuccessfully <- true // Signal success
				initialStartupPhase = false // Stop checking for this message
				// Emit the started event *here* upon confirmation
				runtime.EventsEmit(a.ctx, "overlay-started", map[string]interface{}{
					"pid":       pid,
					"startedAt": time.Now().Format(time.RFC3339),
					"message":   "Overlay confirmed running and waiting.",
				})
			}
			// You could add more filtering/processing here if needed for other output
		}
		if err := scanner.Err(); err != nil && err != io.EOF {
			runtime.LogWarningf(a.ctx, "[Monitor PID %d] Error reading stdout: %v", pid, err)
		}
		runtime.LogInfof(a.ctx, "[Monitor PID %d] Stdout reader finished.", pid)
		// If stdout closes *before* the success message was seen, signal failure
		if initialStartupPhase {
			runtime.LogWarningf(a.ctx, "[Monitor PID %d] Stdout closed before success message was seen.", pid)
			startedSuccessfully <- false // Signal failure
		}
		close(startedSuccessfully) // Close channel when done
	}()

	// --- Goroutine to read Stderr ---
	go func() {
		defer wg.Done()
		defer stderrPipe.Close() // Close the pipe when done reading
		scanner := bufio.NewScanner(stderrPipe)
		runtime.LogInfof(a.ctx, "[Monitor PID %d] Reading stderr...", pid)
		for scanner.Scan() {
			line := scanner.Text()
			// Log ALL stderr output
			runtime.LogWarningf(a.ctx, "[ModTools STDERR PID %d]: %s", pid, line)
		}
		if err := scanner.Err(); err != nil && err != io.EOF {
			runtime.LogWarningf(a.ctx, "[Monitor PID %d] Error reading stderr: %v", pid, err)
		}
		runtime.LogInfof(a.ctx, "[Monitor PID %d] Stderr reader finished.", pid)
	}()

	// --- Wait for Startup Confirmation or Failure ---
	select {
	case success := <-startedSuccessfully:
		if !success {
			runtime.LogError(a.ctx, fmt.Sprintf("[Monitor PID %d] Overlay failed to start (confirmation message not received or stdout closed early).", pid))
			// Emit stopped event immediately on startup failure
			runtime.EventsEmit(a.ctx, "overlay-stopped", map[string]interface{}{
				"pid":       pid,
				"stoppedAt": time.Now().Format(time.RFC3339),
				"exitError": true,
				"errorMsg":  "Overlay failed confirmation.",
				"exitCode":  -1, // Unknown exit code at this stage
			})
			// Attempt to clean up the process if it's still running somehow
			_ = cmd.Process.Kill() // Ignore error
			_ = cmd.Wait()         // Consume the Wait potentially
			// Clean up global state if this PID was the one we stored
			if a.modToolsPid == pid {
				a.modToolsProcess = nil
				a.modToolsPid = 0
			}
			return // Exit monitor early on startup failure
		}
		runtime.LogInfof(a.ctx, "[Monitor PID %d] Overlay confirmed started.", pid)

	case <-time.After(15 * time.Second): // Timeout for startup confirmation
		runtime.LogError(a.ctx, fmt.Sprintf("[Monitor PID %d] Timeout waiting for overlay confirmation message.", pid))
		runtime.EventsEmit(a.ctx, "overlay-stopped", map[string]interface{}{
			"pid":       pid,
			"stoppedAt": time.Now().Format(time.RFC3339),
			"exitError": true,
			"errorMsg":  "Timeout waiting for overlay confirmation.",
			"exitCode":  -1,
		})
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		if a.modToolsPid == pid {
			a.modToolsProcess = nil
			a.modToolsPid = 0
		}
		return // Exit monitor early on timeout
	}

	// --- Now, Wait for the process to actually exit ---
	// This will block until mod-tools.exe terminates for any reason later on.
	waitErr := cmd.Wait()

	runtime.LogInfof(a.ctx, "[Monitor PID %d] Process Wait() returned.", pid)

	// Wait for the reader goroutines to finish processing any remaining output
	runtime.LogInfof(a.ctx, "[Monitor PID %d] Waiting for I/O readers to finish...", pid)
	wg.Wait()
	runtime.LogInfof(a.ctx, "[Monitor PID %d] I/O readers finished.", pid)

	// Process the final result after Wait() completes
	exitCode := 0
	errMsg := ""
	isError := waitErr != nil
	if waitErr != nil {
		errMsg = waitErr.Error()
		if exitError, ok := waitErr.(*exec.ExitError); ok {
			if status, ok := exitError.Sys().(syscall.WaitStatus); ok {
				exitCode = status.ExitStatus()
			}
		}
		runtime.LogWarningf(a.ctx, "[Monitor PID %d] Process finished with error: %v (Exit Code: %d)", pid, waitErr, exitCode)
	} else {
		runtime.LogInfof(a.ctx, "[Monitor PID %d] Process finished successfully (Wait() returned nil).", pid)
	}

	// Emit stopped event
	runtime.EventsEmit(a.ctx, "overlay-stopped", map[string]interface{}{
		"pid":       pid,
		"stoppedAt": time.Now().Format(time.RFC3339),
		"exitError": isError,
		"errorMsg":  errMsg,
		"exitCode":  exitCode,
	})

	// Clear state ONLY if the exited PID matches the currently tracked PID
	if a.modToolsPid == pid {
		a.modToolsProcess = nil
		a.modToolsPid = 0
		runtime.LogInfo(a.ctx, fmt.Sprintf("[Monitor PID %d] Cleared process state.", pid))
	} else {
		runtime.LogWarningf(a.ctx, "[Monitor PID %d] Process exited, but tracked PID is %d. State not cleared.", pid, a.modToolsPid)
	}

	runtime.LogInfof(a.ctx, "[Monitor PID %d] Exited monitoring goroutine.", pid)
}

func (a *App) RunModToolCommand(command string, args []string) (map[string]interface{}, error) {
	cmd := exec.Command(absModToolsPath, append([]string{command}, args...)...)

	// Configurar para ejecutar en segundo plano sin ventana (solo Windows)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x08000000, // CREATE_NO_WINDOW
		HideWindow:    true,
	}

	// Redirigir stdout y stderr a archivos de log
	stdoutFile, err := os.Create("stdout.log")
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}, err
	}
	defer stdoutFile.Close()

	stderrFile, err := os.Create("stderr.log")
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}, err
	}
	defer stderrFile.Close()

	cmd.Stdout = stdoutFile
	cmd.Stderr = stderrFile

	// Iniciar el proceso sin esperar
	if err := cmd.Start(); err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}, err
	}

	// Guardar referencia al proceso SOLO para runoverlay
	if command == "runoverlay" {
		// Esperar 1s y verificar si el proceso sigue vivo
		time.Sleep(1 * time.Second)
		if process, err := os.FindProcess(cmd.Process.Pid); err == nil {
			a.modToolsProcess = process
		} else {
			runtime.LogWarning(a.ctx, "El proceso terminó inmediatamente después de iniciar")
		}
	}

	// Goroutine para manejar la finalización (solo para comandos no persistentes)
	if command != "runoverlay" {
		go func() {
			err := cmd.Wait()
			if err != nil {
				runtime.LogError(a.ctx, fmt.Sprintf("Proceso %s terminó con error: %v", command, err))
			}
		}()
	}

	// Respuesta inmediata para runoverlay
	if command == "runoverlay" {
		return map[string]interface{}{
			"success": true,
			"pid":     cmd.Process.Pid,
		}, nil
	}

	return map[string]interface{}{"success": true}, nil
}

// RestartModTools reinicia mod-tools con las skins instaladas
func (a *App) RestartModTools() (bool, error) {
	runtime.LogInfo(a.ctx, "RestartModTools called.")
	killed, err := a.KillModTools()
	if !killed {
		runtime.LogWarningf(a.ctx, "RestartModTools: KillModTools reported failure (error: %v), but attempting to start new process anyway.", err)
	} else {
		runtime.LogInfo(a.ctx, "RestartModTools: Successfully stopped existing process (or none was running).")
	}

	time.Sleep(250 * time.Millisecond) // Allow OS cleanup

	// Call StartRunOverlay which launches the process and the new monitor
	// The *result* map from StartRunOverlay only indicates the command was issued.
	// True success depends on the 'overlay-started' event.
	result := a.StartRunOverlay()

	// Check if the command *failed to even start*
	if success, _ := result["success"].(bool); !success {
		errMsg := "Failed to initiate overlay process during restart."
		if errStr, ok := result["error"].(string); ok {
			errMsg = fmt.Sprintf("Failed to initiate overlay process during restart: %s", errStr)
		}
		return false, fmt.Errorf(errMsg)
	}

	// If StartRunOverlay reported "already running", treat as success for restart intent.
	if msg, ok := result["message"].(string); ok && msg == "Overlay is already running" {
		runtime.LogWarning(a.ctx, "RestartModTools: StartRunOverlay reported overlay was already running unexpectedly after kill attempt.")
		return true, nil
	}

	// Log that the process was initiated. The frontend/caller should listen for
	// 'overlay-started' or 'overlay-stopped' events for the actual status.
	runtime.LogInfo(a.ctx, "RestartModTools: Overlay process initiation request sent. Monitor will provide confirmation.")
	return true, nil // Returning true means the *restart attempt* was successfully initiated
}

// FilterAndFormatOutput filtra y formatea la salida de mod-tools
func filterAndFormatOutput(output string) string {
	lines := strings.Split(output, "\n")
	var filtered []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "[DLL] info:") || strings.Contains(line, "[INF] Done!") {
			continue
		}
		if strings.Contains(line, "redirected wad:") {
			parts := strings.Split(line, "/")
			wad := parts[len(parts)-1]
			line = fmt.Sprintf("Hunted wad: %s", wad)
		}
		if strings.Contains(line, "[INF] Writing wad:") {
			parts := strings.Split(line, "/")
			wad := parts[len(parts)-1]
			line = fmt.Sprintf("Hunted wad: %s", wad)
		}
		filtered = append(filtered, line)
	}
	return strings.Join(filtered, "\n")
}

// Expresiones regulares precompiladas para mejor rendimiento
var (
	regexRedirectedWad = regexp.MustCompile(`redirected wad: .*/([^/]+\.wad\.client)`)
	regexWritingWad    = regexp.MustCompile(`\[INF\] Writing wad: .*/([^/]+\.wad\.client)`)
)

// CleanupTempFiles elimina archivos temporales
func (a *App) CleanupTempFiles() error {
	files, err := os.ReadDir(absInstalledPath)
	if err != nil {
		if os.IsNotExist(err) {
			runtime.LogWarningf(a.ctx, "CleanupTempFiles: Directory %s does not exist.", absInstalledPath)
			return nil
		}
		runtime.LogError(a.ctx, fmt.Sprintf("CleanupTempFiles: Error reading directory %s: %v", absInstalledPath, err))
		return err
	}
	runtime.LogInfof(a.ctx, "Cleaning temp files in %s", absInstalledPath)
	removedCount := 0
	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".tmp") {
			tmpFilePath := filepath.Join(absInstalledPath, file.Name())
			if err := os.Remove(tmpFilePath); err == nil {
				runtime.LogInfof(a.ctx, "Removed temp file: %s", tmpFilePath)
				removedCount++
			} else {
				runtime.LogWarningf(a.ctx, "Failed to remove temp file %s: %v", tmpFilePath, err)
			}
		}
	}
	if removedCount > 0 {
		runtime.LogInfof(a.ctx, "Removed %d temp files.", removedCount)
	}
	return nil
}

// UninstallSkin desinstala una skin
func (a *App) UninstallSkin(championId string) map[string]interface{} {
	skin, exists := a.installedSkins[championId]
	if !exists {
		return map[string]interface{}{"success": false, "error": "Skin not found"}
	}
	runtime.LogInfo(a.ctx, "UninstallSkin: Stopping overlay before uninstalling...")
	killed, killErr := a.KillModTools() // Use the refined kill function
	if !killed {
		runtime.LogWarningf(a.ctx, "Failed to stop overlay before uninstall: %v. Proceeding anyway.", killErr)
		// Decide if you want to block uninstall if kill fails, usually not.
	}

	filePath := filepath.Join(a.installedPath, skin.FileName)
	if err := os.Remove(filePath); err != nil {
		// Log error but continue cleanup
		runtime.LogWarningf(a.ctx, "Failed to remove skin file %s, renaming to .tmp: %v", filePath, err)
		os.Rename(filePath, filePath+".tmp") // Attempt rename
	}
	delete(a.installedSkins, championId)
	if err := a.SaveInstalledSkins(); err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("Failed to save installed skins after uninstall: %v", err))
		// Return error here? Or just log? For now, log and continue.
	}

	runtime.LogInfo(a.ctx, "UninstallSkin: Recreating overlay...")
	// Restart the overlay if needed (createOverlayOnly might need adjustment
	// if it implicitly assumes RunModToolCommand starts a *new* overlay)
	// For now, let's assume StartOverlay/RestartModTools is the correct action after uninstall.
	success, err := a.RestartModTools()
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to restart overlay after uninstall: %v", err)}
	}
	return map[string]interface{}{"success": success, "message": "Skin uninstalled and overlay restarted"}
}

// UninstallMultipleSkins desinstala múltiples skins
func (a *App) UninstallMultipleSkins(championIds []string) map[string]interface{} {
	if len(championIds) == 0 {
		return map[string]interface{}{"success": false, "error": "No champions selected"}
	}
	runtime.LogInfo(a.ctx, "UninstallMultipleSkins: Stopping overlay before uninstalling...")
	killed, killErr := a.KillModTools() // Use the refined kill function
	if !killed {
		runtime.LogWarningf(a.ctx, "Failed to stop overlay before multi-uninstall: %v. Proceeding anyway.", killErr)
	}

	changesMade := false
	for _, championId := range championIds {
		if skin, exists := a.installedSkins[championId]; exists {
			filePath := filepath.Join(a.installedPath, skin.FileName)
			if err := os.Remove(filePath); err != nil {
				runtime.LogWarningf(a.ctx, "Failed to remove skin file %s, renaming to .tmp: %v", filePath, err)
				os.Rename(filePath, filePath+".tmp")
			}
			delete(a.installedSkins, championId)
			changesMade = true
		}
	}

	if changesMade {
		if err := a.SaveInstalledSkins(); err != nil {
			runtime.LogError(a.ctx, fmt.Sprintf("Failed to save installed skins after multi-uninstall: %v", err))
		}
	}

	runtime.LogInfo(a.ctx, "UninstallMultipleSkins: Recreating overlay...")
	success, err := a.RestartModTools()
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to restart overlay after multi-uninstall: %v", err)}
	}
	return map[string]interface{}{"success": success, "message": "Skins uninstalled and overlay restarted"}
}

// createOverlayOnly recrea el overlay sin reiniciar mod-tools
func (a *App) createOverlayOnly() map[string]interface{} {
	if len(a.installedSkins) > 0 {
		modsArg := strings.Join(getInstalledFiles(a.installedSkins), "/")
		result, err := a.RunModToolCommand("mkoverlay", []string{a.installedPath, absProfilesPath, "--game:" + GamePath, "--mods:" + modsArg})
		if err != nil {
			return map[string]interface{}{"success": false, "error": err.Error()}
		}
		return result
	}
	return map[string]interface{}{"success": true}
}

func getInstalledFiles(skins map[string]SkinInfo) []string {
	files := make([]string, 0)
	for _, skin := range skins {
		files = append(files, skin.FileName)
	}
	return files
}

// StartOverlay inicia el overlay
func (a *App) StartOverlay() map[string]interface{} {
	success, err := a.RestartModTools()
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	return map[string]interface{}{"success": success}
}

// StopOverlay detiene el overlay
func (a *App) StopOverlay() map[string]interface{} {
	success, err := a.KillModTools()
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	return map[string]interface{}{"success": success}
}

// SaveModStatus guarda el estado del mod
func (a *App) SaveModStatus(statusData map[string]interface{}) map[string]interface{} {
	data, _ := json.MarshalIndent(statusData, "", "  ")
	if err := os.WriteFile(absModStatusPath, data, 0644); err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("Error writing mod status to %s: %v", absModStatusPath, err))
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	return map[string]interface{}{"success": true}
}

// GetModStatus obtiene el estado del mod
func (a *App) GetModStatus() interface{} {
	data, err := os.ReadFile(absModStatusPath)
	if err != nil {
		return nil
	}
	var status interface{}
	json.Unmarshal(data, &status)
	return status
}

// GetInstalledSkins devuelve las skins instaladas
func (a *App) GetInstalledSkins() []map[string]interface{} {
	installedJsonPathAbs := filepath.Join(absInstalledPath, "installed.json")
	data, err := os.ReadFile(installedJsonPathAbs)
	if err != nil {
		// Log más específico
		if !os.IsNotExist(err) {
			runtime.LogError(a.ctx, fmt.Sprintf("Error reading %s: %v", installedJsonPathAbs, err))
		}
		return []map[string]interface{}{} // Devuelve vacío si no existe o hay error
	}
	// ... unmarshal ...
	var installedSkins []map[string]interface{}
	if err := json.Unmarshal(data, &installedSkins); err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("Error parsing %s: %v", installedJsonPathAbs, err))
		return []map[string]interface{}{}
	}
	return installedSkins
}

// CleanupLocalStorage limpia el almacenamiento local
func (a *App) CleanupLocalStorage() map[string]interface{} {
	os.Remove(absModStatusPath)
	return map[string]interface{}{"success": true}
}

// Login autentica un usuario
func (a *App) Login(login, password string) map[string]interface{} {
	user, err := findUserByLogin(login)
	if err != nil || user == nil {
		return map[string]interface{}{"success": false, "error": "User not found"}
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user["password"].(string)), []byte(password)); err != nil {
		return map[string]interface{}{"success": false, "error": "Incorrect password"}
	}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id": user["id"],
	}).SignedString([]byte(JWTSecret))
	return map[string]interface{}{
		"success": true,
		"message": "Login successful",
		"token":   token,
		"user": map[string]interface{}{
			"id":            user["id"],
			"email":         user["email"],
			"login":         user["login"],
			"fichasporskin": user["fichasporskin"],
			"escomprador":   user["escomprador"],
		},
	}
}

// Register registra un nuevo usuario
func (a *App) Register(email, password, login string) map[string]interface{} {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}

	// Create user data
	userData := map[string]interface{}{
		"email":         email,
		"password":      string(hashedPassword),
		"login":         login,
		"fichasporskin": 0,
		"escomprador":   false,
	}

	var result interface{}
	_, err = supabaseClient.From("users").Insert(userData, false, "", "", "").ExecuteTo(&result)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok || resultMap == nil {
		return map[string]interface{}{"success": false, "error": "No user data returned"}
	}

	return map[string]interface{}{
		"success": true,
		"message": "Register successful",
		"user": map[string]interface{}{
			"id":            resultMap["id"],
			"email":         email,
			"login":         login,
			"fichasporskin": 0,
			"escomprador":   false,
		},
	}
}

// UpdateUserData actualiza los datos de un usuario
func (a *App) UpdateUserData(userId string, data map[string]interface{}) error {
	_, err := supabaseClient.From("users").Update(data, "id", "eq").ExecuteTo(nil)
	return err
}

// DownloadSkin descarga e instala una skin desde Supabase Storage
func (a *App) DownloadSkin(championId, skinNum, userId string, token, skinName, fileName, chromaName, sanitizedImageUrl, baseSkinName string) map[string]interface{} {
	// Verificar token JWT
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(JWTSecret), nil
	})
	if err != nil {
		return map[string]interface{}{"success": false, "error": "Invalid token"}
	}

	// Buscar usuario por ID
	user, err := findUserById(userId)
	if err != nil {
		return map[string]interface{}{"success": false, "error": "User not found"}
	}

	if !user["escomprador"].(bool) {
		return map[string]interface{}{"success": false, "error": "No tienes acceso a esta función"}
	}

	// Cargar skins instaladas existentes
	if err := a.LoadInstalledSkins(); err != nil {
		fmt.Printf("Warning: Could not load existing skins: %v\n", err)
	}

	// Generar nombre de archivo sanitizado
	absFilePath := filepath.Join(absInstalledPath, fileName) // Ruta absoluta donde guardar

	// Descargar skin desde Supabase Storage
	bucket := "campeones"
	skinPath := fmt.Sprintf("campeones/%s/%s.fantome", championId, skinNum)

	// Descargar el archivo usando Supabase Go Storage
	fileBytes, err := downloadFileFromSupabase(bucket, skinPath)
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Error downloading skin: %v", err)}
	}

	// Guardar el archivo descargado
	err = os.WriteFile(absFilePath, fileBytes, 0644)
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Error saving skin file: %v", err)}
	}

	// // Importar skin con mod-tools
	// importResult, err := a.RunModToolCommand("import", []string{
	// 	filePath,
	// 	filePath,
	// 	"--noTFT",
	// 	"--game:" + GamePath,
	// 	"--verbose",
	// })

	// if err != nil {
	// 	// Intentar obtener el error detallado del resultado
	// 	if errMsg, ok := importResult["error"].(string); ok && errMsg != "" {
	// 		runtime.LogError(a.ctx, fmt.Sprintf("Import error: %v - %s", err, errMsg))
	// 		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Import error: %s", errMsg)}
	// 	}
	// 	runtime.LogError(a.ctx, fmt.Sprintf("Import error: %v", err))
	// 	return map[string]interface{}{"success": false, "error": fmt.Sprintf("Import error: %v", err)}
	// }

	// if importResult["success"] != true {
	// 	if errMsg, ok := importResult["error"].(string); ok && errMsg != "" {
	// 		runtime.LogError(a.ctx, fmt.Sprintf("Import failed: %s", errMsg))
	// 		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Import failed: %s", errMsg)}
	// 	}
	// 	return map[string]interface{}{"success": false, "error": "Failed to import skin: unknown error"}
	// }

	// // Verificar que el archivo se haya importado correctamente
	// importedPath := filepath.Join(a.installedPath, fileName)
	// if _, err := os.Stat(importedPath); os.IsNotExist(err) {
	// 	runtime.LogError(a.ctx, fmt.Sprintf("Imported file not found: %s", importedPath))
	// 	return map[string]interface{}{"success": false, "error": "Imported file not found"}
	// }

	// // Registrar la skin en installedSkins
	// a.installedSkins[championId] = SkinInfo{
	// 	SkinId:     skinNum,
	// 	FileName:   fileName,
	// 	ProcessId:  "0",
	// 	ChromaName: chromaName,
	// 	SkinName:   baseSkinName,
	// 	ImageUrl:   sanitizedImageUrl,
	// }
	// a.SaveInstalledSkins()

	// // Crear el overlay con todas las skins instaladas
	// modsArg := strings.Join(getInstalledFiles(a.installedSkins), "/")
	// _, err = a.RunModToolCommand("mkoverlay", []string{
	// 	a.installedPath,
	// 	ProfilesPath,
	// 	"--game:" + GamePath,
	// 	"--mods:" + modsArg,
	// })
	// if err != nil {
	// 	return map[string]interface{}{"success": false, "error": fmt.Sprintf("Error creating overlay: %v", err)}
	// }

	return map[string]interface{}{
		"success": true,
		"message": "Skin Downloaded successfully",
	}
}

// downloadFileFromSupabase descarga un archivo desde Supabase Storage
func downloadFileFromSupabase(bucket, path string) ([]byte, error) {
	// Crear un nuevo cliente de storage
	storageClient := storage.NewClient(
		SupabaseURL+"/storage/v1",
		SupabaseKey,
		map[string]string{
			"Authorization": "Bearer " + SupabaseKey,
		},
	)

	// Crear la URL de descarga
	downloadURL := fmt.Sprintf("%s/object/public/%s/%s", SupabaseURL+"/storage/v1", bucket, path)

	// Crear la solicitud
	req, err := storageClient.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %v", err)
	}

	// Realizar la solicitud
	var response *http.Response
	if response, err = storageClient.Do(req, nil); err != nil {
		return nil, fmt.Errorf("error downloading file: %v", err)
	}
	defer response.Body.Close()

	// Leer el contenido
	return io.ReadAll(response.Body)
}

// FetchChampionJson obtiene el JSON de un campeón desde Supabase Storage
func (a *App) FetchChampionJson(champId string) map[string]interface{} {
	bucket := "api_json" // Ajusta el nombre del bucket según tu configuración
	path := fmt.Sprintf("%s.json", champId)

	data, err := downloadFileFromSupabase(bucket, path)
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Error fetching champion data: %v", err)}
	}

	var championData map[string]interface{}
	if err := json.Unmarshal(data, &championData); err != nil {
		return map[string]interface{}{"success": false, "error": "Invalid champion data format"}
	}

	return map[string]interface{}{
		"success": true,
		"data":    championData,
	}
}

func copyFile(srcFilePath, dstFilePath string) error {
	// Abrir el archivo fuente
	srcFile, err := os.Open(srcFilePath)
	if err != nil {
		return fmt.Errorf("Error opening source file: %v", err)
	}
	defer srcFile.Close()

	// Crear el archivo de destino
	dstFile, err := os.Create(dstFilePath)
	if err != nil {
		return fmt.Errorf("Error creating destination file: %v", err)
	}
	defer dstFile.Close()

	// Copiar el contenido del archivo fuente al archivo de destino
	_, err = io.Copy(dstFile, srcFile)
	if err != nil {
		return fmt.Errorf("Error copying file: %v", err)
	}

	// Asegurarse de que los cambios se escriban en el archivo de destino
	err = dstFile.Sync()
	if err != nil {
		return fmt.Errorf("Error syncing file: %v", err)
	}

	return nil
}

// InstallSkin instala una skin y mantiene el proceso en segundo plano
func (a *App) InstallSkin(championId, skinId, fileName, chromaName, imageUrl, baseSkinName string) map[string]interface{} {

	absFilePath := filepath.Join(absInstalledPath, fileName) // Ruta absoluta del archivo .fantome

	if _, err := os.Stat(absFilePath); os.IsNotExist(err) {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Skin file not found at %s", absFilePath)}
	}

	runtime.LogInfo(a.ctx, "InstallSkin: Stopping overlay before import...")

	a.CleanupTempFiles()
	// EnsureDirectoriesAbs es llamado en startup, no es necesario aquí de nuevo a menos que algo pueda borrarlos

	// Importar skin usando rutas absolutas
	runtime.LogInfo(a.ctx, "InstallSkin: Importing skin...")
	importArgs := []string{
		absFilePath, // Ruta absoluta al archivo a importar
		absFilePath, // Asumiendo destino = origen para fantome
		"--noTFT",
		// "--game:" + absGamePath, // ¿Necesita 'import' la ruta del juego? Añadir si es necesario
	}
	importResult, err := a.RunAndWaitModToolCommand("import", importArgs)
	if err != nil { /* Manejar error */
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Import failed: %v", err)}
	}
	if importSuccess, _ := importResult["success"].(bool); !importSuccess { /* Manejar fallo */
		return map[string]interface{}{"success": false, "error": "Import command reported failure."}
	}

	// Registrar la skin (no cambia)
	a.installedSkins[championId] = SkinInfo{
		SkinId:     skinId,
		FileName:   fileName,
		ProcessId:  "0",
		ChromaName: chromaName,
		SkinName:   baseSkinName,
		ImageUrl:   imageUrl,
	}
	if err := a.SaveInstalledSkins(); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to save installed skins: %v", err),
		}
	}

	// Crear overlay usando rutas absolutas y nombres de mods relativos
	runtime.LogInfo(a.ctx, "InstallSkin: Creating overlay...")
	installedFiles := getInstalledFiles(a.installedSkins)
	modsArgStr := ""
	if len(installedFiles) > 0 {
		modsArgStr = "--mods:" + strings.Join(installedFiles, "/")
	}
	overlayArgs := []string{
		absInstalledPath, // Directorio absoluto de skins instaladas
		absProfilesPath,  // Directorio absoluto de perfil de salida
		"--game:" + absGamePath,
	}
	if modsArgStr != "" {
		overlayArgs = append(overlayArgs, modsArgStr)
	}
	mkOverlayResult, err := a.RunAndWaitModToolCommand("mkoverlay", overlayArgs)
	if err != nil { /* Manejar error */
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("mkoverlay failed: %v", err)}
	}
	if mkSuccess, _ := mkOverlayResult["success"].(bool); !mkSuccess { /* Manejar fallo */
		return map[string]interface{}{"success": false, "error": "mkoverlay command reported failure."}
	}

	// Ejecutar el overlay en segundo plano
	runtime.LogInfo(a.ctx, "InstallSkin: Starting overlay process...")
	success, err := a.RestartModTools() // RestartModTools usa StartRunOverlay que ya usa rutas absolutas
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to start overlay after install: %v", err)}
	}
	if !success {
		return map[string]interface{}{"success": false, "error": "Failed to start overlay after install (unknown reason)."}
	}

	return map[string]interface{}{"success": true, "message": "Skin installed and overlay started."}
}
func (a *App) RunAndWaitModToolCommand(command string, args []string) (map[string]interface{}, error) {
	modToolsDir := filepath.Dir(absModToolsPath)

	// Usa RUTA ABSOLUTA para el ejecutable
	cmd := exec.Command(absModToolsPath, append([]string{command}, args...)...)
	// Establece WD al directorio del ejecutable
	cmd.Dir = modToolsDir

	runtime.LogInfof(a.ctx, "Running command (and waiting): %s %v (WD: %s)", absModToolsPath, cmd.Args, cmd.Dir)

	outputBytes, err := cmd.CombinedOutput()
	output := string(outputBytes)

	if err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("Command '%s' failed with error: %v", command, err))
		runtime.LogError(a.ctx, fmt.Sprintf("Command '%s' output: %s", command, output))
		return map[string]interface{}{"success": false, "output": output, "error": err.Error()}, err
	}

	runtime.LogInfof(a.ctx, "Command '%s' completed successfully.", command)
	// runtime.LogDebugf(a.ctx, "Command '%s' output: %s", command, output) // Descomentar si necesitas ver output exitoso
	return map[string]interface{}{"success": true, "output": output}, nil
}

// GetUserData obtiene datos del usuario
func (a *App) GetUserData(token string) map[string]interface{} {
	claims := jwt.MapClaims{}
	decoded, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(JWTSecret), nil
	})

	if err != nil || !decoded.Valid {
		return map[string]interface{}{"success": false, "error": "Invalid token"}
	}

	// Ensure id is converted to string
	userId := fmt.Sprintf("%.0f", claims["id"].(float64))
	user, err := findUserById(userId)
	if err != nil {
		return map[string]interface{}{"success": false, "error": "User not found"}
	}

	return map[string]interface{}{
		"success": true,
		"user":    user,
	}
}

// Funciones auxiliares de Supabase
func findUserById(userId string) (map[string]interface{}, error) {
	data, _, err := supabaseClient.From("users").Select("*", "", false).Eq("id", userId).Single().Execute()
	if err != nil {
		return nil, err
	}
	var user map[string]interface{}
	json.Unmarshal(data, &user)
	return user, nil
}

func findUserByLogin(login string) (map[string]interface{}, error) {
	data, _, err := supabaseClient.From("users").Select("*", "", false).Eq("login", login).Single().Execute()
	if err != nil {
		return nil, err
	}
	var user map[string]interface{}
	json.Unmarshal(data, &user)
	return user, nil
}

func generateFileName(skinName, chromaName string) string {
	// Limpieza del nombre base (skinName)
	baseName := strings.ToLower(strings.ReplaceAll(skinName, "[^a-z0-9\\s-]", ""))
	baseName = strings.ReplaceAll(baseName, "\\s+", "-")

	// Verificar si chromaName es vacío o null
	if chromaName == "" || chromaName == "null" { // 'null' en string, si es un valor no esperado.
		return fmt.Sprintf("%s.fantome", baseName)
	}

	// Limpieza del nombre chroma
	chromaPart := strings.ToLower(strings.ReplaceAll(chromaName, "[^a-z0-9\\s-]", ""))
	chromaPart = strings.ReplaceAll(chromaPart, "\\s+", "-")

	return fmt.Sprintf("%s-%s.fantome", baseName, chromaPart)
}
