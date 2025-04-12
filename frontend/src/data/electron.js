//@electron.js

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_PATH = app.isPackaged
  ? path.join(process.resourcesPath)  // En producción, apunta a 'resources'
  : path.join(__dirname, '..');       // En desarrollo, apunta al código fuente

// Rutas dentro de resources
const INSTALLED_PATH = path.join(BASE_PATH, 'LoLModInstaller', 'installed');
const PROFILES_PATH = path.join(BASE_PATH, 'LoLModInstaller', 'profiles', 'Default');
const MOD_TOOLS_PATH = path.join(BASE_PATH, 'cslol-tools', 'mod-tools.exe');
const MOD_STATUS_PATH = path.join(BASE_PATH, 'LoLModInstaller', 'mod-status.json');
const INSTALLED_JSON_PATH = path.join(INSTALLED_PATH, 'installed.json'); // Corregido: Ya no incluye 'installed.json' dos veces
const GAME_PATH = 'C:\\Riot Games\\League of Legends\\Game';

let mainWindow;
let modToolsProcess = null;
let installedSkins = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    maxWidth: 1200,
    maxHeight: 800,
    minWidth: 800,
    minHeight: 700,
    width: 800,
    height: 700,
    darkTheme: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    titleBarOverlay: {
      color: "#00000000", // Transparente (RGBA)
      symbolColor: "#FFFFFF" // Color de los botones de control (Cerrar, Minimizar, Maximizar)
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      preload: path.join(BASE_PATH, "app", "dist" , 'preload.cjs'),
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(BASE_PATH, "app", 'build', 'index.html'));

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

async function ensureDirectories() {
  try {
    await fs.mkdir(INSTALLED_PATH, { recursive: true });
    console.log(`Created directory: ${INSTALLED_PATH}`);
    
    await fs.mkdir(PROFILES_PATH, { recursive: true });
    console.log(`Created directory: ${PROFILES_PATH}`);
    
    await fs.mkdir(path.dirname(MOD_STATUS_PATH), { recursive: true });
    console.log(`Created directory: ${path.dirname(MOD_STATUS_PATH)}`);
    
    // Log the actual paths to verify they're correct
    console.log('BASE_PATH:', BASE_PATH);
    console.log('INSTALLED_PATH:', INSTALLED_PATH);
    console.log('MOD_STATUS_PATH:', MOD_STATUS_PATH);
    console.log('INSTALLED_JSON_PATH:', INSTALLED_JSON_PATH);
  } catch (error) {
    console.error('Error ensuring directories:', error);
  }
}

async function ensureModStatusDirectory() {
  try {
    await fs.mkdir(path.dirname(MOD_STATUS_PATH), { recursive: true });
    console.log(`Created mod status directory: ${path.dirname(MOD_STATUS_PATH)}`);
  } catch (error) {
    console.error('Error creating mod status directory:', error);
  }
}

async function loadInstalledSkins() {
  try {
    const data = await fs.readFile(INSTALLED_JSON_PATH, 'utf8');
    const skinsArray = JSON.parse(data);
    installedSkins = new Map(
      skinsArray.map(skin => [skin.championId, {
        skinId: skin.skinId,
        fileName: skin.fileName,
        processId: skin.processId,
        chromaName: skin.chromaName,
          skinName: skin.skinName // Load Skin Name
      }])
    );
    console.log('Loaded installed skins from:', INSTALLED_JSON_PATH);
  } catch (err) {
    console.log('No existing installed skins found, starting fresh:', INSTALLED_JSON_PATH);
    installedSkins = new Map();
  }
}

async function saveInstalledSkins() {
  try {
    const skinsArray = Array.from(installedSkins.entries()).map(([championId, data]) => ({
      championId,
      ...data
    }));
    await fs.writeFile(
      INSTALLED_JSON_PATH,
      JSON.stringify(skinsArray, null, 2)
    );
    console.log('Saved installed skins to:', INSTALLED_JSON_PATH);
  } catch (error) {
    console.error('Error saving installed skins:', error);
  }
}

async function killProcess(processName) {
  try {
    await execAsync(`taskkill /F /IM "${processName}" /T`);
    return true;
  } catch (error) {
    console.error(`Failed to kill ${processName}:`, error);
    return false;
  }
}

async function killModTools() {
  if (modToolsProcess) {
    try {
      // Enviar señal SIGINT (equivalente a Ctrl+C)
      process.kill(modToolsProcess.pid, 'SIGINT');

      // Esperar a que el proceso se cierre limpiamente
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verificar si el proceso aún está vivo
      try {
        process.kill(modToolsProcess.pid, 0);
        await killProcess('mod-tools.exe');
      } catch (e) {
        // El proceso ya está cerrado
      }

      modToolsProcess = null;
      return true;
    } catch (error) {
      console.error('Error killing mod-tools process:', error);
      return false;
    }
  }
  return true;
}

async function waitForFileUnlock(filePath, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const fileHandle = await fs.open(filePath, 'r+');
      await fileHandle.close();
      return true;
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

function sendStatusUpdate(status) {
  if (mainWindow) {
    console.log("Sending status to frontend:", status); // DEBUG
    mainWindow.webContents.send('status-update', status);
  }
}

function filterAndFormatOutput(output) {
  return output
    .split("\n")
    .map(line => line.trim()) // Eliminar espacios en blanco
    .filter(line => {
      return !(
        line.includes("[DLL] info: Init in process!") ||
        line.includes("[DLL] info: patching module") ||
        line.includes("[DLL] info: Kernel32 module") ||
        line.includes("[DLL] info: Hoking CreateFileA") ||
        line.includes("[INF] Done!") 
      );
    })
    .map(line => {
      // Reemplazar "redirected wad" por "Hunted wad"
      let match = line.match(/redirected wad: .*\/([^\/]+\.wad\.client)/);
      if (match) return `Hunted wad: ${match[1]}`;

      // Reemplazar "[INF] Writing wad" por "Hunted wad"
      match = line.match(/\[INF\] Writing wad: .*\/([^\/]+\.wad\.client)/);
      if (match) return `Hunted wad: ${match[1]}`;

      return line;
    })
    .filter(line => line.length > 0) // Eliminar líneas vacías
    .join("\n");
}

function runModToolCommand(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(MOD_TOOLS_PATH, [command, ...args]);
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      let output = data.toString().trim(); // Convertir a string y limpiar espacios
      if (!output) return; // Si está vacío, no hacer nada
    
      const filteredOutput = filterAndFormatOutput(output); // Aplicar filtro
      if (!filteredOutput) return; // Si el filtrado elimina todo, no hacer nada
    
      // Enviar cada línea por separado
      filteredOutput.split("\n").forEach(line => {
        console.log(`Filtered mod-tools output: ${line}`);
        sendStatusUpdate(line);
      });
    
      stdout += filteredOutput + "\n"; // Seguir almacenando en stdout
    
      if (
        command === "runoverlay" &&
        filteredOutput.includes("Status: Waiting for league match to start")
      ) {
        resolve({ success: true, pid: process.pid });
      }
    });
    
    process.stderr.on("data", (data) => {
      stderr += data.toString();
      console.error(`mod-tools error: ${data}`);
    });

    process.on("close", (code) => {
      if (command === "runoverlay") return;

      if (code === 0) {
        if (command === "import" || command === "mkoverlay") {
          resolve({ success: true });
        } else {
          reject(new Error(`Unexpected output: ${stdout.trim()}`));
        }
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });
  });
}

async function restartModTools() {
  try {
    await killModTools();

    // Construir el argumento --mods con todas las skins instaladas
    const installedFiles = Array.from(installedSkins.values())
      .map(skin => skin.fileName)
      .join(',');

    const args = [
      PROFILES_PATH,
      `--game:${GAME_PATH}`,
      'configless'
    ];

    if (installedFiles) {
      args.push(`--mods:${installedFiles}`);
    }

    const { success, pid } = await runModToolCommand('runoverlay', args);

    if (success && pid) {
      modToolsProcess = { pid };
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error restarting mod-tools:', error);
    return false;
  }
}

async function cleanupTempFiles() {
  try {
    const files = await fs.readdir(INSTALLED_PATH);
    for (const file of files) {
      if (file.endsWith('.tmp')) {
        try {
          await fs.unlink(path.join(INSTALLED_PATH, file));
        } catch (error) {
          console.error('Failed to delete temp file:', file, error);
        }
      }
    }
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

// IPC Handlers
//Receive and store the name.
ipcMain.handle('install-skin', async (event, { championId, skinId, fileName, chromaName, imageUrl, baseSkinName }) => {
  try {
    const filePath = path.join(INSTALLED_PATH, fileName);
      
    // Ensure the file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`Skin file not found: ${fileName}`);
    }

    // Kill existing mod-tools process if any
    await killModTools();

    // Clean up any temporary files
    await cleanupTempFiles();

    // Create necessary directories
    await ensureDirectories();

    // Copy the skin file to the installed directory
    const installedFilePath = path.join(INSTALLED_PATH, fileName);
    await fs.copyFile(filePath, installedFilePath);

    // Import skin
    await runModToolCommand('import', [
      installedFilePath,
      installedFilePath,
      '--noTFT'
    ]);

    // Update installedSkins map with chroma and imageUrl information, including skinName.
    installedSkins.set(championId, {
      skinId,
      fileName,
      chromaName,
      imageUrl, // Store imageUrl
      skinName: baseSkinName, // Store baseSkinName
      processId: null
    });


    // Save to installed.json
    await saveInstalledSkins();

    // Create overlay with all installed skins
    const modsArg = Array.from(installedSkins.values())
      .map(skin => skin.fileName)
      .join('/');

    await runModToolCommand('mkoverlay', [
      INSTALLED_PATH,
      PROFILES_PATH,
      `--game:${GAME_PATH}`,
      `--mods:${modsArg}`
    ]);

    // Start mod-tools process
    const result = await restartModTools();
    return { success: true, ...result };
  } catch (error) {
    console.error('Error installing skin:', error);
    return { success: false, error: error.message };
  }
});

async function createOverlayOnly() {
  try {
    // Recreate overlay with all installed skins
    if (installedSkins.size > 0) {
      const modsArg = Array.from(installedSkins.values())
        .map(skin => skin.fileName)
        .join('/');

      await runModToolCommand('mkoverlay', [
        INSTALLED_PATH,
        PROFILES_PATH,
        `--game:${GAME_PATH}`,
        `--mods:${modsArg}`
      ]);
      
      return { success: true };
    } else {
      console.log('No skins to create overlay for');
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to create overlay:', error);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('uninstall-skin', async (event, championId) => {
  try {
    const skinInfo = installedSkins.get(championId);
    if (!skinInfo) {
      throw new Error('No skin installed for this champion');
    }

    // Detener mod-tools
    await killModTools();

    // Eliminar el archivo de la skin
    const filePath = path.join(INSTALLED_PATH, skinInfo.fileName);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Error removing skin file:', error);
      // Mover a archivo temporal si no se puede eliminar
      const tempPath = `${filePath}.tmp`;
      await fs.rename(filePath, tempPath);
    }

    // Eliminar la entrada del mapa y guardar
    installedSkins.delete(championId);
    await saveInstalledSkins();

    // Recrear overlay con las skins restantes, pero sin reiniciar mod-tools
    await createOverlayOnly();

    return { success: true };
  } catch (error) {
    console.error('Uninstall error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('uninstall-multiple-skins', async (event, championIds) => {
  try {
    if (!Array.isArray(championIds) || championIds.length === 0) {
      throw new Error('No champions selected for uninstallation');
    }

    // Detener mod-tools
    await killModTools();

    // Process each skin removal
    for (const championId of championIds) {
      const skinInfo = installedSkins.get(championId);
      if (!skinInfo) continue; // Skip if not found

      // Eliminar el archivo de la skin
      const filePath = path.join(INSTALLED_PATH, skinInfo.fileName);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        console.error(`Error removing skin file for champion ${championId}:`, error);
        // Mover a archivo temporal si no se puede eliminar
        const tempPath = `${filePath}.tmp`;
        await fs.rename(filePath, tempPath);
      }

      // Eliminar la entrada del mapa
      installedSkins.delete(championId);
    }

    // Guardar cambios
    await saveInstalledSkins();

    // Recrear overlay con las skins restantes, pero sin reiniciar mod-tools
    await createOverlayOnly();

    return { success: true };
  } catch (error) {
    console.error('Uninstall multiple skins error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-overlay', async () => {
  try {
    const success = await restartModTools();
    if (!success) {
      throw new Error('Failed to start mod-tools process');
    }
    return { success: true };
  } catch (error) {
    console.error('Start overlay error:', error);
    return { success: false, error: error.message };
  }
});

// New handler for stopping the mod-tools overlay
ipcMain.handle('stop-overlay', async () => {
  try {
    const success = await killModTools();
    if (!success) {
      throw new Error('Failed to stop mod-tools process');
    }
    return { success: true };
  } catch (error) {
    console.error('Stop overlay error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-mod-status', async (event, statusData) => {
  try {
    await ensureModStatusDirectory();
    await fs.writeFile(MOD_STATUS_PATH, JSON.stringify(statusData, null, 2));
    console.log('Saved mod status to:', MOD_STATUS_PATH);
    return { success: true };
  } catch (error) {
    console.error('Error saving mod status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-mod-status', async () => {
  try {
    await ensureModStatusDirectory();
    try {
      const data = await fs.readFile(MOD_STATUS_PATH, 'utf8');
      console.log('Loaded mod status from:', MOD_STATUS_PATH);
      return JSON.parse(data);
    } catch (error) {
      // If file doesn't exist, return null
      if (error.code === 'ENOENT') {
        console.log('No mod status file found at:', MOD_STATUS_PATH);
        return null;
      }
      throw error;
    }
  } catch (error) {
    console.error('Error reading mod status:', error);
    return null;
  }
});

ipcMain.handle('get-installed-skins', async () => {
  return [...installedSkins];
});

ipcMain.handle('cleanup-localStorage', async () => {
  try {
    // Remove mod status JSON file
    await fs.unlink(MOD_STATUS_PATH).catch((err) => {
      console.log('No mod status file to delete or error:', err);
    });
    return { success: true };
  } catch (error) {
    console.error('Cleanup error:', error);
    return { success: false };
  }
});

// App event handlers
app.on('ready', async () => {
  await ensureDirectories();
  await loadInstalledSkins();
  await cleanupTempFiles();
  createWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

// Cleanup on app quit
app.on('before-quit', async () => {
  await killModTools();
  if (mainWindow) {
    mainWindow.webContents.send('cleanup-storage');
  }
});