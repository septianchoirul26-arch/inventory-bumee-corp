import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Suppliers from "@/pages/Suppliers";
import StockIn from "@/pages/StockIn";
import StockOpname from "@/pages/StockOpname";
import OpnameSession from "@/pages/OpnameSession";
import Adjustment from "@/pages/Adjustment";
import History from "@/pages/History";
import Payables from "@/pages/Payables";
import Settlements from "@/pages/Settlements";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Memuat...</div>;
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/produk" element={<Products />} />
        <Route path="/supplier" element={<Suppliers />} />
        <Route path="/stock-in" element={<StockIn />} />
        <Route path="/stock-opname" element={<StockOpname />} />
        <Route path="/stock-opname/:id" element={<OpnameSession />} />
        <Route path="/adjustment" element={<Adjustment />} />
        <Route path="/history" element={<History />} />
        <Route path="/hutang" element={<Payables />} />
        <Route path="/settlement" element={<Settlements />} />
        <Route path="/report" element={<Reports />} />
        <Route path="/pengaturan" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="top-right" richColors />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}
