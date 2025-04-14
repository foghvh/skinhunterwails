//@download.jsx
import { toast } from 'sonner';
import { useUser } from '../context/usercontext';
import { GetUserData, InstallSkin, DownloadSkin } from '../../wailsjs/go/main/App';

export const useDownloadSkin = () => {
  const { revalidateUser } = useUser();

  const sanitizeFileName = (name) => {
    return name
      .replace(/[^a-z0-9\s-]/gi, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
  };

  const generateFileName = (skin, chromaName = null) => {
    const baseName = sanitizeFileName(skin);
    const chromaPart = chromaName ? `-${sanitizeFileName(chromaName)}` : '';
    return `${baseName}${chromaPart}.fantome`;
  };
  
  const sanitizeImageUrl = (url) => {
    if (!url) return '';
    const baseUrl = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/';
    if (url.startsWith(baseUrl)) {
         return url.substring(baseUrl.length);
       }
      return url; 
  };

const downloadSkin = async (championId, skinId, setUserData, skin, selectedChroma) => {
  const loadingToast = toast.loading('Processing download...');

  try {
    const token = localStorage.getItem("token");

    if (!token) {
      toast.dismiss(loadingToast);
      toast.error("You are not authenticated. Please log in to continue.");
      return;
    }

    const userResponse = await GetUserData(token);
    const userData = userResponse.user;

    if (!userData) {
      toast.dismiss(loadingToast);
      toast.error("User not found. Please log in again.");
      return;
    }

    if (userData.fichasporskin <= 0) {
      toast.dismiss(loadingToast);
      toast.error("Insufficient credits. Please purchase more.");
      return;
    }

    const skinNum = skinId % 1000;
    const chromaName = selectedChroma ? selectedChroma.name : null;
    const imageUrl = skin.tilePath;
    const baseSkinName = skin.name;
    const fileName = generateFileName(baseSkinName, chromaName);
    const sanitizedImageUrl = sanitizeImageUrl(imageUrl);

    console.log("Downloading skin with parameters:", {
      championId: String(Math.floor(skinId / 1000)),
      skinNum: String(skinNum),
      userId: String(userData.id),
      token: token,
      skinName: String(skin.name),
      fileName: String(fileName),
      chromaName: chromaName || "",
      sanitizedImageUrl: String(sanitizedImageUrl),
      baseSkinName: String(baseSkinName),
    });

    // Descargar skin
    const downloadResponse = await DownloadSkin(
      String(Math.floor(skinId / 1000)),
      String(skinNum),
      String(userData.id),
      token,
      String(skin.name),
      String(fileName),
      chromaName || "",
      String(sanitizedImageUrl),
      String(baseSkinName)
    );
    console.log("Download response:", downloadResponse);

    if (!downloadResponse.success) {
      throw new Error(downloadResponse.error || "Failed to download skin");
    }

    toast.dismiss(loadingToast);
    const installingToast = toast.loading('Installing skin...');

    try {
      // Instalar skin
      const installResult = await InstallSkin(
        String(championId),
        String(skinId),
        String(fileName),
        chromaName || "",
        String(sanitizedImageUrl),
        String(baseSkinName)
      );

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install skin');
      }

      toast.dismiss(installingToast);
      toast.success(`${selectedChroma ? 'Chroma' : 'Skin'} installed successfully!`);

      // Actualizar datos del usuario
      await revalidateUser();
      const refreshedResponse = await GetUserData(token);
      if (refreshedResponse.user) {
        setUserData(refreshedResponse.user);
      }
    } catch (installError) {
      toast.dismiss(installingToast);
      throw new Error(`Installation failed: ${installError.message}`);
    }
  } catch (error) {
    console.error('Download/Install error:', error);
    toast.dismiss(loadingToast);
    toast.error(error.message || "An unexpected error occurred.");
  }
};

return downloadSkin;
}