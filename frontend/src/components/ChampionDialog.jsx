import React, { memo, useState } from 'react';
import {
  Text,
  Card,
  Box,
  Flex,
  Skeleton,
  Inset,
  Separator,
  Dialog,
  Button,
  Progress,
  Popover,
  IconButton,
  Slider,
  Badge,
  ScrollArea
} from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';

const ChampionDialog = memo(({ champData, style, roleColors, damageColors, asset }) => {
  const [isLoadingDs, setIsLoadingDs] = useState(true);

  const handleImageLoads = () => setIsLoadingDs(false);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button mt="5">View more</Button>
      </Dialog.Trigger>
      <Dialog.Content className="custom-dialog" maxWidth="850px" aria-describedby={undefined}>
        <Dialog.Title>{champData.name}</Dialog.Title>

        <Flex
          direction={{ initial: "column", md: "row", xl: "row" }}
          justify={{ initial: "center", md: "space-between", xl: "space-between" }}
          align={{ initial: "center", md: "start", xl: "start-between" }}
          gap="4"
          style={{ width: "100%" }}
          className="w-full"
        >
          {/* Champion Image and Bio */}
          <Box style={{ flex: 1, maxWidth: "100%" }}>
            <Card
              size="4"
              style={{
                width: "100%",
                maxWidth: "450px",
                padding: "1rem",
              }}
            >
              {isLoadingDs && (
                <Box
                  className="skeleton-container bg-primary"
                  style={{
                    width: "100%",
                    aspectRatio: "16/9",
                    height: "100%",
                    maxHeight: "300px",
                  }}
                >
                  <Skeleton className="w-full h-full" />
                </Box>
              )}
                        {/* Champion Image & Bio */}

              <Inset clip="border-box" side="all" pb="current" size="" style={{ display: isLoadingDs ? "none" : "block" }}>
                <img
                  src={
                    champData?.defaultSkins[0]?.splashPath
                      ? asset(champData.defaultSkins[0].splashPath)
                      : ""
                  }
                  alt="Champion Splash"
                  style={{
                    display: "block",
                    objectFit: "cover",
                    width: "100%",
                    height: "auto",
                    maxHeight: "300px",
                  }}
                  onLoad={handleImageLoads}
                />
              </Inset>
              <ScrollArea type="auto" scrollbars="vertical" style={{ height: 180 }}>
              <Text as="p" size="3" className='pr-4 pt-2' >
                {champData.shortBio}
              </Text>
              </ScrollArea>
            </Card>
          </Box>

          {/* Champion Stats */}
          <Flex direction="column" gap="3" align="start" className="w-full" style={{ flex: 1 }}>
            {/* Difficulty */}
            <Flex direction="column" style={{ width: "100%" }}>
              <Text as="h1" size="5" mb="4">Difficulty
                <Popover.Root>
                  <Popover.Trigger>
                    <IconButton variant="soft" ml="2" size="1">
                      <InfoCircledIcon />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Content size="3" maxWidth="300px">
                    <Text as="p" trim="both" size="3">
                      The champion difficulty.
                    </Text>
                  </Popover.Content>
                </Popover.Root>
              </Text>
              <Separator size="4" orientation="horizontal" />
              <Box align="center">
                <Progress value={champData?.tacticalInfo?.difficulty * 25 || 0} size="2" mx="auto" />
              </Box>
            </Flex>

            {/* Style */}
            <Flex direction="column" style={{ width: "100%" }}>
              <Text as="h1" size="5">Style
                <Popover.Root>
                  <Popover.Trigger>
                    <IconButton ml="2" variant="soft" size="1">
                      <InfoCircledIcon />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Content size="3" maxWidth="300px">
                    <Text as="p" trim="both" size="3">
                      The champion's tendency to deal damage using basic attacks vs. abilities.
                    </Text>
                  </Popover.Content>
                </Popover.Root>
              </Text>
              <Separator size="4" orientation="horizontal" />
              <Flex direction="row" justify="between" align="center" my="auto" style={{ marginTop: "1.5rem", height: "100%" }}>
                <Box
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: champData?.tacticalInfo?.style <= 5 ? 1 : 0.5,
                    transition: "opacity 0.3s",
                  }}
                >
                  <img
                    src={style({ tipo: "kASHighlight" })?.[0] || ""}
                    alt={style({ tipo: "kASHighlight" })?.[1] || "Attack"}
                    style={{ height: "40px", width: "40px" }}
                  />
                </Box>
                <Box style={{ flexGrow: 1, margin: "0 1rem" }}>
                  <Slider
                    defaultValue={[champData?.tacticalInfo?.style * 10 || 0]}
                    size="2"
                    style={{ width: "100%", backgroundColor: "#6e6e6e", pointerEvents: "none" }}
                  />
                </Box>
                <Box
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: champData?.tacticalInfo?.style > 5 ? 1 : 0.5,
                    transition: "opacity 0.3s",
                  }}
                >
                  <img
                    src={style({ tipo: "kMagicHighlight" })?.[0] || ""}
                    alt={style({ tipo: "kMagicHighlight" })?.[1] || "Magic"}
                    style={{ height: "40px", width: "40px" }}
                  />
                </Box>
              </Flex>
            </Flex>

            {/* Damage */}
            <Flex direction="column" style={{ width: "100%" }}>
              <Text as="h1" size="5">Damage
                <Popover.Root>
                  <Popover.Trigger>
                    <IconButton variant="soft" ml="2" size="1">
                      <InfoCircledIcon />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Content size="3" maxWidth="300px">
                    <Text as="p" trim="both" size="3">
                      The champion tendency to deal physical, magic or mixed damage.
                    </Text>
                  </Popover.Content>
                </Popover.Root>
              </Text>
              <Separator size="4" orientation="horizontal" />
              <Flex direction="row" gap="10px" wrap="wrap">
                <Badge
                  mt="3"
                  variant="soft"
                  color={damageColors[champData.tacticalInfo.damageType] || "gray"}
                  style={{ textTransform: "capitalize", fontSize: "0.9rem" }}
                >
                  {champData.tacticalInfo.damageType.slice(1)}
                </Badge>
                <Box className="w-full" mt="2" align="center">
                  <Progress value={champData?.playstyleInfo?.damage * 25 || 0} size="2" mx="auto" />
                </Box>
              </Flex>
            </Flex>

            {/* Roles */}
            <Flex direction="column" style={{ width: "100%", marginTop: "1rem" }}>
              <Text as="h1" size="5">Roles
                <Popover.Root>
                  <Popover.Trigger>
                    <IconButton variant="soft" ml="2" size="1">
                      <InfoCircledIcon />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Content size="3" maxWidth="300px">
                    <Text as="p" trim="both" size="3">
                    Champion Roles
                    </Text>
                  </Popover.Content>
                </Popover.Root>
              </Text>
              <Separator size="4" orientation="horizontal" />
              <Flex direction="row" gap="10px" wrap="wrap">
                {champData.roles.map((role, index) => (
                  <Badge
                    key={index}
                    mt="3"
                    variant="soft"
                    color={roleColors[role] || "gray"}
                    style={{ textTransform: "capitalize", fontSize: "0.9rem" }}
                  >
                    {role}
                  </Badge>
                ))}
              </Flex>
            </Flex>

            <Dialog.Description />
            <Dialog.Close className="custom-dialog" asChild>
              <Button>Close</Button>
            </Dialog.Close>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
});

export default ChampionDialog;
