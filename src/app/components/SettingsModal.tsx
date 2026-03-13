"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Eye, EyeOff, Save, Key, Link2, Box, CheckCircle2, Loader2, Plus, Trash2, FolderOpen } from "lucide-react";

const DEFAULT_PROJECTS = [
    "Rạch xuyên tâm",
    "Hương lộ 11",
    "Xử lý nước thải tây ninh",
    "Thường Phước",
    "Cầu Mã Đà",
    "Tổng Hợp",
];

interface Settings {
    apiKey: string;
    model: string;
    scriptUrl: string;
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (settings: Settings) => void;
}

export default function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
    const [settings, setSettings] = useState<Settings>({
        apiKey: "",
        model: "gpt-4o",
        scriptUrl: "",
    });

    const [projects, setProjects] = useState<string[]>(DEFAULT_PROJECTS);
    const [newProject, setNewProject] = useState("");

    const [showPassword, setShowPassword] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [apiTestStatus, setApiTestStatus] = useState<"IDLE" | "TESTING" | "SUCCESS" | "ERROR">("IDLE");
    const [scriptTestStatus, setScriptTestStatus] = useState<"IDLE" | "TESTING" | "SUCCESS" | "ERROR">("IDLE");

    useEffect(() => {
        const saved = localStorage.getItem("contract_ai_settings");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setSettings(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error("Failed to parse settings");
            }
        }
        const savedProjects = localStorage.getItem("tnec_hd_projects");
        if (savedProjects) {
            try {
                const parsed = JSON.parse(savedProjects);
                if (Array.isArray(parsed) && parsed.length > 0) setProjects(parsed);
            } catch (e) {
                console.error("Failed to parse projects");
            }
        }
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        await new Promise(r => setTimeout(r, 800));
        localStorage.setItem("contract_ai_settings", JSON.stringify(settings));
        localStorage.setItem("tnec_hd_projects", JSON.stringify(projects));
        onSave(settings);
        setIsSaving(false);
        onClose();
    };

    const handleAddProject = () => {
        const name = newProject.trim();
        if (!name) return;
        if (projects.includes(name)) {
            alert("Dự án này đã tồn tại!");
            return;
        }
        setProjects([...projects, name]);
        setNewProject("");
    };

    const handleRemoveProject = (index: number) => {
        if (projects.length <= 1) {
            alert("Phải giữ ít nhất 1 dự án.");
            return;
        }
        setProjects(projects.filter((_, i) => i !== index));
    };

    const handleTestApi = async () => {
        if (!settings.apiKey) return;
        setApiTestStatus("TESTING");
        await new Promise(r => setTimeout(r, 1000));
        setApiTestStatus(settings.apiKey.startsWith("sk-") ? "SUCCESS" : "ERROR");
        setTimeout(() => setApiTestStatus("IDLE"), 3000);
    };

    const handleTestScript = async () => {
        if (!settings.scriptUrl) return;
        setScriptTestStatus("TESTING");
        await new Promise(r => setTimeout(r, 1000));
        setScriptTestStatus(settings.scriptUrl.includes("script.google.com") ? "SUCCESS" : "ERROR");
        setTimeout(() => setScriptTestStatus("IDLE"), 3000);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto"
                    >
                        <div className="bg-[#0f1423]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-neon-cyan via-blue-500 to-neon-yellow opacity-50" />

                            <div className="flex justify-between items-center mb-8">
                                <h2 className="text-2xl font-bold text-white tracking-tight">Configuration</h2>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-6">
                                {/* API Key Field */}
                                <div>
                                    <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                                        <Key className="w-4 h-4 text-neon-cyan" /> OpenAI API Key
                                    </label>
                                    <div className="relative flex gap-2">
                                        <div className="relative flex-1">
                                            <input
                                                type={showPassword ? "text" : "password"}
                                                value={settings.apiKey}
                                                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                                                placeholder="sk-..."
                                                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/50 transition-all font-mono text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                                            >
                                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                        <button
                                            onClick={handleTestApi}
                                            disabled={!settings.apiKey || apiTestStatus === "TESTING"}
                                            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-center min-w-[100px]"
                                        >
                                            {apiTestStatus === "TESTING" ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                                apiTestStatus === "SUCCESS" ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
                                                    apiTestStatus === "ERROR" ? <span className="text-red-400 text-sm">Failed</span> :
                                                        <span className="text-sm">Test</span>}
                                        </button>
                                    </div>
                                    <p className="text-xs text-white/40 mt-1.5 ml-1">Dùng để kết nối với model GPT-4o cho tác vụ AI.</p>
                                </div>

                                {/* Model Selector */}
                                <div>
                                    <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                                        <Box className="w-4 h-4 text-neon-yellow" /> AI Model
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={settings.model}
                                            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white appearance-none focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/50 transition-all cursor-pointer"
                                        >
                                            <option value="gpt-4o" className="bg-[#0f1423] text-white">gpt-4o</option>
                                            <option value="gpt-4.1" className="bg-[#0f1423] text-white">gpt-4.1 (Recommended)</option>
                                            <option value="gpt-4.1-mini" className="bg-[#0f1423] text-white">gpt-4.1-mini (Nhanh + Rẻ)</option>
                                            <option value="gpt-4.1-nano" className="bg-[#0f1423] text-white">gpt-4.1-nano (Siêu nhanh)</option>
                                            <option value="o4-mini" className="bg-[#0f1423] text-white">o4-mini (Suy luận mạnh)</option>
                                            <option value="gpt-4-turbo" className="bg-[#0f1423] text-white">gpt-4-turbo</option>
                                        </select>
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                                            ▼
                                        </div>
                                    </div>
                                </div>

                                {/* Apps Script URL Field */}
                                <div>
                                    <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                                        <Link2 className="w-4 h-4 text-blue-400" /> Google Apps Script URL
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={settings.scriptUrl}
                                            onChange={(e) => setSettings({ ...settings, scriptUrl: e.target.value })}
                                            placeholder="https://script.google.com/macros/s/..."
                                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/50 transition-all font-mono text-xs"
                                        />
                                        <button
                                            onClick={handleTestScript}
                                            disabled={!settings.scriptUrl || scriptTestStatus === "TESTING"}
                                            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-center min-w-[100px]"
                                        >
                                            {scriptTestStatus === "TESTING" ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                                scriptTestStatus === "SUCCESS" ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
                                                    scriptTestStatus === "ERROR" ? <span className="text-red-400 text-sm">Failed</span> :
                                                        <span className="text-sm">Test</span>}
                                        </button>
                                    </div>
                                    <p className="text-xs text-white/40 mt-1.5 ml-1">Đường dẫn Web App để đẩy dữ liệu lên Google Sheets.</p>
                                </div>

                                {/* ── Project Manager Section ── */}
                                <div className="pt-4 border-t border-white/10">
                                    <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-3">
                                        <FolderOpen className="w-4 h-4 text-emerald-400" /> Quản lý dự án
                                    </label>
                                    <p className="text-xs text-white/40 mb-3 ml-1">
                                        Danh sách dự án hiển thị trong dropdown. Tên phải khớp với tab trên Google Sheets.
                                    </p>

                                    {/* Project list */}
                                    <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
                                        {projects.map((project, idx) => (
                                            <div key={idx} className="flex items-center gap-2 group">
                                                <div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80">
                                                    {project}
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveProject(idx)}
                                                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Xóa dự án"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Add new project */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newProject}
                                            onChange={(e) => setNewProject(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && handleAddProject()}
                                            placeholder="Nhập tên dự án mới..."
                                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/50 transition-all"
                                        />
                                        <button
                                            onClick={handleAddProject}
                                            disabled={!newProject.trim()}
                                            className="px-3 py-2 bg-emerald-500/15 border border-emerald-500/30 rounded-lg text-emerald-400 hover:bg-emerald-500/25 transition-colors flex items-center gap-1.5 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Thêm
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="mt-10 flex justify-end">
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="relative px-8 py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2 overflow-hidden group"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan/20 to-neon-yellow/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4" /> Save Configuration
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
