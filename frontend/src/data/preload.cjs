//@preload.cjs
const { getConfig } = require('./config.cjs');

const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs/promises')


const SUPABASE_URL = getConfig('SUPABASE_URL');
const SUPABASE_KEY = getConfig('SUPABASE_KEY');
const JWT_SECRET = getConfig('JWT_SECRET');


if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Variables de entorno de Supabase no encontradas');
  throw new Error('Configuration error: Missing Supabase environment variables');
}


const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);
const sanitizeFileName = (name) => {
  return name
    .replace(/[^a-z0-9\s-]/gi, '') // Eliminar caracteres no permitidos
    .replace(/\s+/g, '-') // Reemplazar espacios con guiones
    .toLowerCase();
};

const generateFileName = (skin, chromaName = null) => {
  const baseName = sanitizeFileName(skin.name);
  const chromaPart = chromaName ? `-${sanitizeFileName(chromaName)}` : '';
  return `${baseName}${chromaPart}.fantome`;
};

async function findUserById(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

async function findUserByLogin(login) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('login', login)
    .single();
  if (error) return null;
  return data;
}

async function updateFichas(userId, newFichas) {
  const { data, error } = await supabase
    .from('users')
    .update({ fichasporskin: newFichas })
    .eq('id', userId);
  if (error) throw error;
  return data;
}

contextBridge.exposeInMainWorld("electron", {
  getChampionsPath: () => path.join(__dirname, "../build/champions"),
});


contextBridge.exposeInMainWorld('modTools', {
//Add the baseSkinName
  installSkin: async (championId, skinId, fileName, chromaName, imageUrl, baseSkinName) => {
    return await ipcRenderer.invoke('install-skin', { championId, skinId, fileName, chromaName, imageUrl, baseSkinName });
  },

  uninstallSkin: async (championId) => {
    return await ipcRenderer.invoke('uninstall-skin', championId);
  },

  uninstallMultipleSkins: async (championIds) => {
    return await ipcRenderer.invoke('uninstall-multiple-skins', championIds);
  },

  getInstalledSkins: async () => {
    return await ipcRenderer.invoke('get-installed-skins');
  },

  startOverlay: async () => {
    return await ipcRenderer.invoke('start-overlay');
  },

  stopOverlay: async () => {
    return await ipcRenderer.invoke('stop-overlay');
  }
});

contextBridge.exposeInMainWorld('cleanup', {
  clearStorage: async () => {
    return await ipcRenderer.invoke('cleanup-localStorage');
  },

  // New methods for mod status JSON
  saveModStatus: async (statusData) => {
    return await ipcRenderer.invoke('save-mod-status', statusData);
  },

  getModStatus: async () => {
    return await ipcRenderer.invoke('get-mod-status');
  }
});

// Also update the existing cleanup listener
ipcRenderer.on('cleanup-storage', () => {
  localStorage.removeItem('modStatus');
});


contextBridge.exposeInMainWorld('modStatus', {
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_, status) => callback(status));
  },
  removeStatusListener: () => {
    ipcRenderer.removeAllListeners('status-update');
  }
});

contextBridge.exposeInMainWorld('api', {
  login: async (login, password) => {
    try {
      const user = await findUserByLogin(login);
      if (!user) {
        throw new Error('User not found');
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw new Error('Incorrect password');
      }

      const token = jwt.sign(
        { id: user.id },
        JWT_SECRET
      );

      return {
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          login: user.login,
          fichasporskin: user.fichasporskin,
          escomprador: user.escomprador,
        },
      };
    } catch (error) {
      throw new Error(error.message);
    }
  },

  register: async (email, password, login) => {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const { data, error } = await supabase
        .from('users')
        .insert([{ email, password: hashedPassword, login, fichasporskin: 0, escomprador: false }])
        .select();

      if (error) throw error;

      return {
        success: true,
        message: 'Register successful',
        user: {
          id: data[0].id,
          email,
          login,
          fichasporskin: 0,
          escomprador: false,
        },
      };
    } catch (error) {
      throw new Error('Registration error');
    }
  },

fetchChampionJson: async (champId) => {
  try {
    if (!champId) {
      throw new Error('Champion ID is required');
    }

    // Ruta al archivo JSON del campeón en el bucket de Supabase Storage
    const filePath = `champions/${champId}.json`;

    // Descargar el archivo JSON desde Supabase Storage
    const { data, error } = await supabase.storage
      .from('api_json')
      .download(filePath);

    if (error) {
      console.error('Supabase Storage download error:', error);
      return { success: false, message: 'Champion file not found' };
    }

    // Convertir el blob a texto y luego a objeto JSON
    const jsonText = await data.text();
    const jsonData = JSON.parse(jsonText);

    return { success: true, data: jsonData };
  } catch (error) {
    console.error('Error fetching champion JSON from storage:', error);
    return { success: false, message: error.message };
  }
},

 //Add baseSkinName.
  downloadSkin: async (championId, skinNum, userId, token, skin, chromaName, sanitizedImageUrl, baseSkinName) => {
    try {
      if (!token) {
        throw new Error('No authentication token provided');
      }

      const user = await findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.fichasporskin <= 0) {
        throw new Error('Insufficient credits');
      }

      const filePath = `campeones/${championId}/${skinNum}.fantome`;

      // Descargar el archivo desde Supabase Storage
      const { data, error } = await supabase.storage.from('campeones').download(filePath);
      if (error) {
        throw new Error('File not found');
      }

      // Generar nombre de archivo sanitizado
      const sanitizedFileName = generateFileName(skin, chromaName);
      const savePath = path.join(process.resourcesPath, 'LoLModInstaller', 'installed', sanitizedFileName);

      // Guardar el archivo en la ruta correcta
      const buffer = Buffer.from(await data.arrayBuffer());
      await fs.writeFile(savePath, buffer);

      // Verificar que el archivo existe y tiene tamaño válido
      const fileStats = await fs.stat(savePath);
      if (fileStats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      // Reducir fichas y actualizar la base de datos
      const newFichas = user.fichasporskin - 1;
      await updateFichas(userId, newFichas);

      return {
        success: true,
        filePath: savePath,
        fileName: sanitizedFileName,
        imageUrl: sanitizedImageUrl, // Return the sanitized imageUrl
        skinName: baseSkinName   // Also return it.
      };
    } catch (error) {
      throw new Error(error.message);
    }
  },
  getUserData: async (token) => {
    try {
      if (!token) {
        throw new Error('No token provided');
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await findUserById(decoded.id);

      if (!user) {
        throw new Error('User not found');
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          login: user.login,
          fichasporskin: user.fichasporskin,
          esComprador: user.esComprador
        },
      };
    } catch (error) {
      throw new Error(error.message);
    }
  },
});