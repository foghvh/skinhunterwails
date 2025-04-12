import {
  Flex,
  IconButton,
  Dialog,
  Box,
  Heading,
  Avatar,
  Button,
  Card,
  Text,
  Table
} from '@radix-ui/themes';
import React, { useState, useEffect } from 'react';
import { useNavigate } from "react-router-dom";
import ContainerForm from './ContainerForm';
import { useUser } from '../context/usercontext';
import { PersonIcon } from '@radix-ui/react-icons';

export const ProfileDialog = ({ userData, onLogout }) => {
  
    return (
      <Card  variant='ghost' className='max-w-96'>
        <Flex direction="column" gap="4">
          <Flex align="center" gap="3">
            <Avatar
              size="5"
              src={userData?.avatar}
              fallback={userData?.login?.[0]?.toUpperCase() || 'U'}
              radius="full"
            />
            <Box>
              <Heading as="h3" size="4">{userData?.login || 'User'}</Heading>
              <Text as="p" size="2" color="gray">{userData?.email}</Text>
            </Box>
          </Flex>
  
          <Heading as="h2" size="4">Account Details</Heading>
  
          <Table.Root>
            <Table.Body>
              <Table.Row>
                <Table.Cell>
                  <Text as="p" size="2" color="gray">Skins left</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text as="p" size="2">{userData?.fichasporskin || '0'}</Text>
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Text as="p" size="2" color="gray">UID</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text as="p" size="2">
                    {userData?.id || '0'}
                  </Text>
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
          <Flex className='w-full h-5 p-3' justify="end" align="center">
          <Button color="red" size="3"  onClick={onLogout}>
            Logout
          </Button>
          </Flex>
        </Flex>
      </Card>
    );
};


function Profile() {

    const [loginOpen, setLoginOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [currentPopup, setCurrentPopup] = useState("login");
    const { userData, setUserData } = useUser();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
  
    useEffect(() => {
      const fetchUserData = async () => {
          const token = localStorage.getItem("token");
  
          if (!token) {
              setIsLoading(false);
              return;
          }
  
          try {
              const response = await window.api.getUserData(token);
              if (response.success) {
                  setUserData(response.user);
              } else {
                  throw new Error(response.message);
              }
          } catch (error) {
              console.error("Error fetching user data:", error);
              if (error.message === 'No token provided' || error.message === 'Invalid token') {
                  localStorage.removeItem("token");
                  setUserData(null);
              }
          } finally {
              setIsLoading(false);
          }
      };
  
      fetchUserData();
  }, [setUserData, navigate]);
  
    const handleLogout = () => {
      localStorage.removeItem("token");
      setUserData(null);
      setProfileOpen(false);
      navigate("/");
    };
  
    const handleMenuClick = () => {
      const token = localStorage.getItem("token");
      if (token) {
        navigate("/home");
      } else {
        setLoginOpen(true);
      }
    };
  
    const isAuthenticated = !!localStorage.getItem("token");



return ( 

<>

    {/* {isAuthenticated && (
        <>
          <InstalledSkinsDialog />

        <Dialog.Root open={profileOpen} onOpenChange={setProfileOpen}>
          <Dialog.Trigger>
            <IconButton size="3" variant="soft">
              <PersonIcon width="20" height="20" />
            </IconButton>
          </Dialog.Trigger>
          <Dialog.Content aria-describedby={undefined}>
            <Dialog.Title>Profile</Dialog.Title>
            <ProfileDialog userData={userData} onLogout={handleLogout} />
          </Dialog.Content>
        </Dialog.Root>
        </>
      )} */}

        {!isAuthenticated && (
            <Dialog.Root open={loginOpen} onOpenChange={setLoginOpen}>
              <Dialog.Trigger>
              <IconButton size="3" variant="soft">
              <PersonIcon width="20" height="20" />
              </IconButton>
              </Dialog.Trigger>
              <Dialog.Content aria-describedby={undefined}>
                <ContainerForm
                  closePopup={() => setLoginOpen(false)}
                  setCurrentPopup={setCurrentPopup}
                  currentPopup={currentPopup}
                />
              </Dialog.Content>
            </Dialog.Root>
          )}
</>

);
}

export default Profile;