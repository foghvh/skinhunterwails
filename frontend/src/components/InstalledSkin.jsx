// @InstalledSkin.jsx (Corrected and Robust)

import React from 'react';
import {
  Button,
  Text,
  ScrollArea,
  Flex,
  Box,
  Avatar,
  Checkbox
} from '@radix-ui/themes';
import { toast } from 'sonner';
import { motion, AnimatePresence } from "framer-motion";
import { champions, asset, rarity, checkLegacy, getChromasForSkin, _champData, _champDataName, splitId } from "../data/data";
import { GetInstalledSkins, UninstallMultipleSkins } from '../../wailsjs/go/main/App';

const InstalledSkinsDialog = ({ isOpen, onOpenChange }) => {
  const [installedSkins, setInstalledSkins] = React.useState([]);
  const [selectedSkins, setSelectedSkins] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const loadInstalledSkins = async () => {
    setIsLoading(true);
    try {
      const installedSkinsData = await GetInstalledSkins();
      console.log("installedSkinsData:", installedSkinsData); // Depuración

      if (!Array.isArray(installedSkinsData)) {
        throw new Error("GetInstalledSkins did not return an array");
      }

      const enhancedSkins = installedSkinsData.map(skinInfo => {
        const champion = champions.find(c => String(c.id) === String(skinInfo.championId));

        const skinName = skinInfo.skinName || 'Unknown Skin';
        const chromaName = skinInfo.chromaName !== "null" ? skinInfo.chromaName : null; // Manejo de "null" como string
        const tilePath = skinInfo.imageUrl;

        let displayName = skinName;
        if (chromaName) {
          displayName = `${skinName} (${chromaName})`;
        }

        return {
          championId: parseInt(skinInfo.championId),
          skinInfo,
          champion,
          skin: {
            id: skinInfo.skinId,
            name: displayName,
            chromaName,
            tilePath
          }
        };
      });

      setInstalledSkins(enhancedSkins);

    } catch (error) {
      console.error("Error loading skins:", error);
    } finally {
      setIsLoading(false);
    }
  };


  React.useEffect(() => {
    loadInstalledSkins();
  }, []);

  const handleUninstallSelected = async () => {
    if (selectedSkins.length === 0) return;

    const loadingToast = toast.loading(`Uninstalling ${selectedSkins.length} skin(s)...`);
    try {
      const result = await UninstallMultipleSkins(selectedSkins);
      if (!result.success) {
        throw new Error(result.error || 'Failed to uninstall selected skins');
      }
      await loadInstalledSkins();
      toast.dismiss(loadingToast);
      toast.success(`${selectedSkins.length} skin(s) uninstalled successfully`);
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error(error.message || 'Failed to uninstall selected skins');
    }
  };

  const toggleSkinSelection = (championId) => {
    setSelectedSkins(prev => {
      if (prev.includes(championId)) {
        return prev.filter(id => id !== championId);
      } else {
        return [...prev, championId];
      }
    });
  };

  const toggleSelectAll = () => {
    if (selectedSkins.length === installedSkins.length) {
      setSelectedSkins([]);
    } else {
      setSelectedSkins(installedSkins.map(skin => skin.championId));
    }
  };


  return (
    <Flex direction="column" gap="3">
      {!isLoading && installedSkins.length > 0 && (
        <Flex justify="between" align="center" className="px-2">
          <Checkbox
            checked={selectedSkins.length === installedSkins.length && installedSkins.length > 0}
            onCheckedChange={toggleSelectAll}
          >
            <Text as='h1' size="3" className="text-gray-200">Select All</Text>
          </Checkbox>
          <Button
            color="red"
            disabled={selectedSkins.length === 0}
            onClick={handleUninstallSelected}
            size="2"
          >
            Uninstall Selected ({selectedSkins.length})
          </Button>
        </Flex>
      )}

      <ScrollArea style={{ height: 330 }} scrollbars="vertical">
        <div>
          {isLoading ? (
            <Text className="text-gray-200">Loading installed skins...</Text>
          ) : installedSkins.length === 0 ? (
            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              flexDirection: 'column'
            }}>
              <img
                src="https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/icon-shocked-poro.png"
                alt="Shocked Poro"
                style={{
                  filter: 'grayscale(1) saturate(1)',
                  width: '160px',
                  height: 'auto',
                  marginTop: '1em',
                  marginBottom: '1em'
                }}
              />
              <Text className="text-gray-600">No skins installed</Text>
            </div>
          ) : (
            <AnimatePresence>
              {installedSkins.map(({ championId, skinInfo, champion, skin }, i) => {

                return (
                  <motion.div
                    key={championId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Flex
                      align="center"
                      className={`p-2 transition-colors duration-150 ${selectedSkins.includes(championId) ? 'bg-[#2a2a2a]' : 'hover:bg-[#222222]'
                        }`}
                      onClick={() => toggleSkinSelection(championId)}
                    >
                      <Checkbox
                        checked={selectedSkins.includes(championId)}
                        className="mr-2"
                        onCheckedChange={() => toggleSkinSelection(championId)}
                      />
                      <Box className="relative mr-4">
                        <Avatar
                          size="3"
                          src={asset(skin.tilePath)}
                          fallback={(champion?.name || skin.name || '?').charAt(0)} // Use skin.name for fallback
                          className="w-[48px] h-[48px]"
                        />
                      </Box>
                      <Flex direction="column" gap="1" className="flex-1">
                        <Flex align="center" gap="2">
                          <Text className="text-gray-200 font-medium">
                            {skin.name}

                          </Text>
                          {/* Conditionally render additional info based on availability */}
                          {skin && (
                            <RenderSkinProperties skin={skin} championId={championId} />
                          )}
                        </Flex>
                        <Text className="text-[#bebebe] text-sm">
                          {champion?.name || `Champion ID: ${championId}`}
                        </Text>
                      </Flex>
                    </Flex>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>
    </Flex>
  );
};

//Nuevo componente funcional RenderSkinProperties
const RenderSkinProperties = ({ skin, championId }) => {
  const [skinProperties, setSkinProperties] = React.useState({
    rarity: null,
    isLegacy: false,
    chromas: null,
  });

  React.useEffect(() => {
    const fetchProperties = async () => {
      const champData = await _champData(championId);
      if (!champData || !champData.skins) {
        return;
      }

      let skinData = champData.skins.find((s) => String(s.id) === String(skin.id));
      if (!skinData && skin.chromaName) {
        skinData = champData.skins.find((s) =>
          s.chromas?.some((c) => c.name === skin.chromaName)
        );
      }

      setSkinProperties({
        rarity: skinData ? skinData.rarity : null,
        isLegacy: skinData ? skinData.isLegacy : false,
        chromas: skinData ? skinData.chromas : null,
      });
    };

    fetchProperties();
  }, [skin, championId]);

  return (
    <>
      {skinProperties.rarity && rarity({ rarity: skinProperties.rarity }) && (
        <img
          width="16"
          height="16"
          src={rarity({ rarity: skinProperties.rarity })?.[0] || ""}
          title={rarity({ rarity: skinProperties.rarity })?.[1] || ""}
          alt={rarity({ rarity: skinProperties.rarity })?.[1] || ""}
        />
      )}
      {skinProperties.isLegacy && (
        <img
          width="16"
          height="16"
          src={checkLegacy({ isLegacy: skinProperties.isLegacy })[0]}
          title={checkLegacy({ isLegacy: skinProperties.isLegacy })[1]}
          alt="Legacy Icon"
        />
      )}
      {skinProperties.chromas && (
        <img
          width="16"
          height="16"
          src="https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/skin-viewer/icon-chroma-default.png"
          title={`This skin has ${skinProperties.chromas.length} Chroma(s)`}
          alt="Chromas Icon"
          style={{ borderRadius: '50%' }}
        />
      )}
    </>
  );
};

export default InstalledSkinsDialog;