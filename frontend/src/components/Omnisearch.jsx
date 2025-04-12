import React, { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import {
  _ready,
  champions,
  skinlines,
  skins,
  asset,
  splitId,
  _champData,
  _champDataName,
  getChromasForSkin,
  rarity
} from "../data/data";
import {
  Dialog,
  TextField,
  Flex,
  Box,
  CheckboxGroup,
  IconButton,
  Text,
  DropdownMenu,
  Avatar,
  ScrollArea,
  Spinner
} from "@radix-ui/themes";
import { MagnifyingGlassIcon, Cross2Icon, DotsHorizontalIcon } from "@radix-ui/react-icons";
import { useNavigate, generatePath } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import SkinDial from "./SkinDial";

let fuse;

_ready.then(() => {
  fuse = new Fuse([], {
    keys: ["name"],
    threshold: 0.3,
    minMatchCharLength: 2
  });
});

const ResultsSection = ({ title, items, onSelect, selected }) => {
  if (!items.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <Text className="text-gray-400 text-sm px-2 py-1">{title}</Text>
      {items.map((item, i) => (
        <motion.div
          key={item.name}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={() => onSelect(item.$$type, item)}
        >
          <Flex
            align="center"
            className={`p-2 hover:bg-[#2a2a2a] transition-colors duration-150 cursor-pointer mr-4
              ${selected === i ? 'bg-[#2a2a2a]' : ''}`}
          >
            <Avatar
              size="3"
              src={item.$$type !== 'skinline' ? asset(item.$$type === 'champion' ? item.squarePortraitPath : item.tilePath) : undefined}
              fallback={item.name.charAt(0).toUpperCase()}
              className="mr-4"
            />
            <Flex direction="column" gap="1">
              <Text className="text-gray-200 font-medium">{item.name}</Text>
              <Text className="text-[#bebebe] text-sm">
                {item.$$type === "champion" ? "Champion" :
                  item.$$type === "skin" ? "Champion Skin" :
                    "Skinline"}
              </Text>
            </Flex>
          </Flex>
        </motion.div>
      ))}
    </motion.div>
  );
};

export function Omnisearch({ 
  isOpen, 
  onOpenChange, 
  setActiveTab, 
  setSelectedChampion, 
  setSelectedSkinLine 
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [isSkinDialogOpen, setIsSkinDialogOpen] = useState(false);
  const [selectedValues, setSelectedValues] = useState(["1","2", "3"]);
  const [selectedSkinData, setSelectedSkinData] = useState(null);
  const [championData, setChampionData] = useState(null);
  const [champChromas, setChampChromas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState({ champions: [], skins: [], skinlines: [] });

  // Get the current tab state from the URL or context
  useEffect(() => {
    const path = window.location.pathname;
    if (path.includes('champions')) {
      setActiveTab('champions');
    } else if (path.includes('skinlines')) {
      setActiveTab('skinlines');
    }
  }, []);

  const filteredData = useMemo(() => {
    const data = [];

    if (selectedValues.includes("3")) {
      data.push(...champions.map(c => ({ ...c, $$type: "champion" })));
    }
    if (selectedValues.includes("2")) {
      data.push(...Object.values(skins)
        .filter(skin => !skin.isBase)
        .map(s => ({ ...s, $$type: "skin" })));
    }
    if (selectedValues.includes("1")) {
      data.push(...skinlines.map(sl => ({ ...sl, $$type: "skinline" })));
    }

    return data;
  }, [selectedValues]);

  useEffect(() => {
    fuse = new Fuse(filteredData, {
      keys: ["name"],
      threshold: 0.3,
      minMatchCharLength: 2
    });

    if (query.trim()) {
      performSearch(query);
    } else {
      setSearchResults({ champions: [], skins: [], skinlines: [] });
    }
  }, [filteredData]);

  const performSearch = (searchQuery) => {
    if (!searchQuery.trim()) {
      setSearchResults({ champions: [], skins: [], skinlines: [] });
      return;
    }

    const results = fuse.search(searchQuery, { limit: 25 });
    setSearchResults({
      champions: results.filter(r => r.item.$$type === "champion"),
      skins: results.filter(r => r.item.$$type === "skin"),
      skinlines: results.filter(r => r.item.$$type === "skinline")
    });
  };

  const handleSearchInput = (e) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    performSearch(newQuery);
  };

  const handleFilterChange = (newValues) => {
    setSelectedValues(newValues);
  };

  useEffect(() => {
    if (!isSkinDialogOpen) {
      setSelectedSkinData(null);
      setChampionData(null);
      setChampChromas([]);
      setIsLoading(false);
    }
  }, [isSkinDialogOpen]);

  const fetchChampionData = async (champId) => {
    try {
      const champData = await _champData(champId);
      if (champData) {
        setChampionData(champData);

        const additionalData = await _champDataName(champId);
        if (additionalData && additionalData.skins) {
          const allChromas = additionalData.skins
            .map(getChromasForSkin)
            .filter(Boolean)
            .flat();
          setChampChromas(allChromas);
        }
      }
    } catch (error) {
      console.error("Error fetching champion data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  async function onSelect(type, entity) {
    if (type === "champion") {
      // Switch to champions tab and select the champion
      setActiveTab('champions');
      setSelectedChampion(entity.key);
      onOpenChange(false);
    } else if (type === "skinline") {
      // Switch to champions tab (since skinlines are shown there) and select the skinline
      setActiveTab('champions');
      setSelectedSkinLine(entity.id);
      onOpenChange(false);
    } else if (type === "skin") {
      setIsLoading(true);
      const champId = splitId(entity.id)[0];
      setSelectedSkinData(entity);
      onOpenChange(false);
      setIsSkinDialogOpen(true);
      await fetchChampionData(champId);
    }
  }

  return (
    <>
      <Box className="w-full max-w-10 mx-auto">
        <Dialog.Root
          open={isOpen}
          onOpenChange={onOpenChange}
        >
          {/* Eliminar el Dialog.Trigger */}
          
          <AnimatePresence>

            <Dialog.Content className="border-none shadow-lg" maxHeight="600px" aria-describedby={undefined}>
              <Dialog.Title className="text-gray-200">Search</Dialog.Title>

              <Flex gap="4" align="start">
                <TextField.Root
                  size="3"
                  className="flex-1 bg-[#2a2a2a] text-white"
                  placeholder="Search..."
                  value={query}
                  onChange={handleSearchInput}
                  autoFocus
                >
                  <TextField.Slot>
                    <MagnifyingGlassIcon className="text-gray-400" height="16" width="16" />
                  </TextField.Slot>
                  <TextField.Slot pr="3">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        <IconButton size="2" variant="ghost">
                          <DotsHorizontalIcon height="16" width="16" />
                        </IconButton>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content>
                        <CheckboxGroup.Root
                          value={selectedValues}
                          onValueChange={handleFilterChange}
                          className="text-gray-200"
                        >
                          <CheckboxGroup.Item value="1">Skinlines</CheckboxGroup.Item>
                          <CheckboxGroup.Item value="2">Skins</CheckboxGroup.Item>
                          <CheckboxGroup.Item value="3">Champions</CheckboxGroup.Item>
                        </CheckboxGroup.Root>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </TextField.Slot>
                </TextField.Root>
              </Flex>

              {query.length > 0 && (
                <ScrollArea className="mt-4" type="auto" scrollbars="vertical" style={{ height: 450 }} >
                  <ResultsSection
                    title="Champions"
                    items={searchResults.champions.map(m => m.item)}
                    onSelect={onSelect}
                    selected={selected}
                  />
                  <ResultsSection
                    title="Skins"
                    items={searchResults.skins.map(m => m.item)}
                    onSelect={onSelect}
                    selected={selected}
                  />
                  <ResultsSection
                    title="Skinlines"
                    items={searchResults.skinlines.map(m => m.item)}
                    onSelect={onSelect}
                    selected={selected}
                  />
                </ScrollArea>
              )}

              <Dialog.Close className="p-3">
                <IconButton
                  size="3"
                  variant="ghost"
                  className="absolute top-2 right-2 text-gray-400 hover:text-gray-200"
                  onClick={() => onOpenChange(false)}

                >
                  <Cross2Icon />
                </IconButton>
              </Dialog.Close>
            </Dialog.Content>
          </AnimatePresence>

        </Dialog.Root>
      </Box>

      <Dialog.Root
        open={isSkinDialogOpen}
        onOpenChange={setIsSkinDialogOpen}
      >
        {selectedSkinData && (
          isLoading ? (
            <Dialog.Content maxWidth="120px" maxHeight="80px">
              <Flex direction="column" align="center" justify="center" gap="4">
                <Spinner></Spinner>
              </Flex>
            </Dialog.Content>
          ) : (
            championData && (
              <SkinDial
                skin={selectedSkinData}
                champKey={championData.key}
                asset={asset}
                rarity={rarity}
                chromas={champChromas}
              />
            )
          )
        )}
      </Dialog.Root>
    </>
  );
}