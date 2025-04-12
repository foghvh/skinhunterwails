import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { GetUserData } from '../../wailsjs/go/main/App';

const UserContext = createContext();

export function UserProvider({ children }) {
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [revalidationCount, setRevalidationCount] = useState(0);
  const isFirstLoad = useRef(true);

  const revalidateUser = () => {
    setRevalidationCount(prev => prev + 1);
  };

  useEffect(() => {
    const initializeAuth = async () => {
      const token = localStorage.getItem('token');
      
      if (!token) {
        setIsLoading(false);
        return;
      }

      const fetchUser = async () => {
        const response = await GetUserData(token);
        return { data: response }; // Mantener estructura similar a axios para compatibilidad
      };

      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        setTimeout(() => {
          toast.promise(
            fetchUser(),
            {
              loading: 'Loading user data...',
              success: (response) => {
                if (response.data.success) {
                  setUserData(response.data.user);
                  return `Welcome back, ${response.data.user.login}!`;
                }
                throw new Error(response.data.error || 'Failed to load user data');
              },
              error: (error) => {
                console.error('Error initializing auth:', error);
                localStorage.removeItem('token');
                return 'Failed to load user data. Please log in again.';
              },
              finally: () => {
                setIsLoading(false);
              }
            }
          );
        });
      } else {
        try {
          const response = await fetchUser();
          if (response.data.success) {
            setUserData(response.data.user);
          } else {
            throw new Error(response.data.error || 'Failed to load user data');
          }
        } catch (error) {
          console.error('Error initializing auth:', error);
          localStorage.removeItem('token');
          toast.error('Session expired. Please log in again.');
        } finally {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();
  }, [revalidationCount]);

  const value = {
    userData,
    setUserData,
    isLoading,
    revalidateUser
  };

  return (
    <UserContext.Provider value={value}>
      {!isLoading && children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}