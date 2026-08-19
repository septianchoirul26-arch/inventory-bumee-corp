import { createContext, useContext, useEffect, useState } from "react";
import api, { apiError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = logged out, object = user
  const [settings, setSettings] = useState(null);

  const loadSettings = async () => {
    try {
      const { data } = await api.get("/settings");
      setSettings(data);
    } catch {}
  };

  useEffect(() => {
    const token = localStorage.getItem("ims_token");
    if (!token) {
      setUser(false);
      return;
    }
    api
      .get("/auth/me")
      .then(({ data }) => {
        setUser(data);
        loadSettings();
      })
      .catch(() => {
        localStorage.removeItem("ims_token");
        setUser(false);
      });
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("ims_token", data.access_token);
    setUser(data.user);
    loadSettings();
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("ims_token");
    setUser(false);
  };

  const isAdmin = user && user.role === "admin";

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, isAdmin, settings, reloadSettings: loadSettings }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export { apiError };
