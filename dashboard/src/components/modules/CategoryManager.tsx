import React, { useState } from "react";
import { Plus, Edit2, Trash2, AlertCircle, X } from "lucide-react";
import { Button } from "../ui/Button";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Badge } from "../ui/Badge";
import { ConfirmModal } from "../ui/ConfirmModal";

export interface RefundCategoryItem {
  id: string;
  label: string;
  emoji: string;
  description: string;
  enabled: boolean;
}

interface CategoryManagerProps {
  categories: RefundCategoryItem[];
  onChange: (categories: RefundCategoryItem[]) => void;
  maxActiveCategories?: number;
}

const QUICK_EMOJIS = ["🪙", "💵", "💎", "📦", "🚗", "🔫", "🏠", "👕", "💊", "💼", "⚖️", "🎫", "🛠️", "🎮"];

export const CategoryManager: React.FC<CategoryManagerProps> = ({
  categories,
  onChange,
  maxActiveCategories = 24, // 24 active + 1 "All" button = 25 Discord limit
}) => {
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  // Modal form fields
  const [formId, setFormId] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formEmoji, setFormEmoji] = useState("📦");
  const [formDescription, setFormDescription] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState("");

  // Delete confirm modal
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    index: number | null;
    category: RefundCategoryItem | null;
  }>({
    isOpen: false,
    index: null,
    category: null,
  });

  const activeCount = categories.filter((c) => c.enabled !== false).length;
  const isLimitReached = activeCount >= maxActiveCategories;

  const openAddModal = () => {
    setModalMode("add");
    setEditIndex(null);
    setFormId("");
    setFormLabel("");
    setFormEmoji("📦");
    setFormDescription("");
    setFormEnabled(true);
    setFormError("");
  };

  const openEditModal = (cat: RefundCategoryItem, index: number) => {
    setModalMode("edit");
    setEditIndex(index);
    setFormId(cat.id);
    setFormLabel(cat.label || cat.id);
    setFormEmoji(cat.emoji || "📦");
    setFormDescription(cat.description || "");
    setFormEnabled(cat.enabled !== false);
    setFormError("");
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const cleanId = formId.trim();
    const cleanLabel = formLabel.trim();
    const cleanDesc = formDescription.trim();

    // Validations for Discord constraints
    if (!cleanId) {
      setFormError("Category ID is required.");
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(cleanId)) {
      setFormError("Category ID must only contain letters, numbers, hyphens, and underscores (no spaces).");
      return;
    }
    if (cleanId.length > 32) {
      setFormError("Category ID must be 32 characters or fewer.");
      return;
    }
    if (!cleanLabel) {
      setFormError("Category Label is required.");
      return;
    }
    if (cleanLabel.length > 32) {
      setFormError("Category Label must be 32 characters or fewer.");
      return;
    }
    if (cleanDesc.length > 80) {
      setFormError("Description must be 80 characters or fewer for Discord Select Menus.");
      return;
    }

    // Check duplicate ID
    const duplicate = categories.some((c, i) => i !== editIndex && c.id.toLowerCase() === cleanId.toLowerCase());
    if (duplicate) {
      setFormError(`A category with ID "${cleanId}" already exists.`);
      return;
    }

    // Check Discord limit if enabling
    if (formEnabled && (!categories[editIndex ?? -1]?.enabled || modalMode === "add") && isLimitReached) {
      setFormError(`Cannot enable more than ${maxActiveCategories} active categories (Discord Select Menu limit: 25 items).`);
      return;
    }

    const newCategory: RefundCategoryItem = {
      id: cleanId,
      label: cleanLabel,
      emoji: formEmoji || "📦",
      description: cleanDesc,
      enabled: formEnabled,
    };

    if (modalMode === "add") {
      onChange([...categories, newCategory]);
    } else if (modalMode === "edit" && editIndex !== null) {
      const copy = [...categories];
      copy[editIndex] = newCategory;
      onChange(copy);
    }

    setModalMode(null);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm.index !== null) {
      const copy = [...categories];
      copy.splice(deleteConfirm.index, 1);
      onChange(copy);
    }
    setDeleteConfirm({ isOpen: false, index: null, category: null });
  };

  const handleToggle = (index: number, enabled: boolean) => {
    if (enabled && isLimitReached) {
      alert(`Cannot enable more than ${maxActiveCategories} active categories due to Discord Select Menu limits.`);
      return;
    }
    const copy = [...categories];
    copy[index] = { ...copy[index], enabled };
    onChange(copy);
  };

  return (
    <div className="space-y-4">
      {/* Header bar with Discord limit counter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-dark-750 bg-dark-900/60">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200">
              Configured Categories ({categories.length})
            </span>
            <Badge variant={isLimitReached ? "warning" : "success"} dot>
              {activeCount} / {maxActiveCategories} Active
            </Badge>
          </div>
          <p className="text-[11px] text-slate-400">
            Discord limits String Select Menus & filter button rows to 25 items max. Up to {maxActiveCategories} categories can be active at once.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={openAddModal}
        >
          Add Category
        </Button>
      </div>

      {/* Categories Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {categories.map((cat, idx) => (
          <div
            key={cat.id || idx}
            className={`p-4 rounded-xl border transition-all ${
              cat.enabled !== false
                ? "border-dark-750 bg-dark-900 hover:border-dark-600"
                : "border-dark-750/50 bg-dark-900/40 opacity-60"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="text-2xl p-2 rounded-lg bg-dark-850 border border-dark-750 flex-shrink-0">
                  {cat.emoji}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-100">{cat.label || cat.id}</span>
                    <span className="text-[10px] font-mono text-slate-400 bg-dark-950 px-1.5 py-0.5 rounded border border-dark-750">
                      {cat.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {cat.description || "No description configured."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ToggleSwitch
                  size="sm"
                  checked={cat.enabled !== false}
                  onChange={(enabled) => handleToggle(idx, enabled)}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-3 pt-3 border-t border-dark-750/70 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-400">
                {cat.enabled !== false ? (
                  <span className="text-emerald-400 font-medium">Visible in Discord</span>
                ) : (
                  <span className="text-rose-400 font-medium">Disabled in Discord</span>
                )}
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEditModal(cat, idx)}
                  className="p-1.5 text-slate-400 hover:text-brand-orange hover:bg-dark-800 rounded transition-colors"
                  title="Edit Category"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDeleteConfirm({
                      isOpen: true,
                      index: idx,
                      category: cat,
                    })
                  }
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-dark-800 rounded transition-colors"
                  title="Delete Category"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Category Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-dark-700 bg-dark-900 p-6 shadow-2xl space-y-5">
            <button
              onClick={() => setModalMode(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="text-lg font-bold text-slate-100">
                {modalMode === "add" ? "Add Refund Category" : `Edit Category (${formId})`}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Configured categories populate the Discord Refund Center select menu, modals, and search filters.
              </p>
            </div>

            {formError && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveModal} className="space-y-4 text-xs">
              {/* Category ID */}
              <div className="space-y-1">
                <div className="flex justify-between text-slate-300 font-semibold">
                  <label htmlFor="categoryId">Category ID (Stable Internal ID)</label>
                  <span className="font-mono text-[10px] text-slate-400">{formId.length}/32</span>
                </div>
                <input
                  id="categoryId"
                  type="text"
                  value={formId}
                  onChange={(e) => setFormId(e.target.value.replace(/\s+/g, "_"))}
                  placeholder="e.g. Weapons, Vehicles, Property"
                  maxLength={32}
                  disabled={modalMode === "edit"}
                  className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-200 focus:outline-none focus:border-brand-orange disabled:opacity-50"
                  required
                />
                <p className="text-[10px] text-slate-400">
                  Used in database records. Once created, keep this consistent for historical records.
                </p>
              </div>

              {/* Display Label */}
              <div className="space-y-1">
                <div className="flex justify-between text-slate-300 font-semibold">
                  <label htmlFor="categoryLabel">Display Label</label>
                  <span className="font-mono text-[10px] text-slate-400">{formLabel.length}/32</span>
                </div>
                <input
                  id="categoryLabel"
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="e.g. Weapons & Firearms"
                  maxLength={32}
                  className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-200 focus:outline-none focus:border-brand-orange"
                  required
                />
              </div>

              {/* Emoji Selector */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Emoji Icon</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={formEmoji}
                    onChange={(e) => setFormEmoji(e.target.value)}
                    maxLength={4}
                    className="w-16 text-center text-lg px-2 py-1.5 rounded-lg bg-dark-800 border border-dark-700 text-slate-200 focus:outline-none focus:border-brand-orange"
                  />
                  <div className="flex flex-wrap gap-1 flex-1">
                    {QUICK_EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setFormEmoji(em)}
                        className={`w-7 h-7 rounded text-sm hover:bg-dark-750 transition-colors ${
                          formEmoji === em ? "bg-brand-orangeMuted border border-brand-orange" : "bg-dark-800"
                        }`}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <div className="flex justify-between text-slate-300 font-semibold">
                  <label htmlFor="categoryDesc">Description (Optional)</label>
                  <span className="font-mono text-[10px] text-slate-400">{formDescription.length}/80</span>
                </div>
                <input
                  id="categoryDesc"
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Short description displayed in Discord select menu..."
                  maxLength={80}
                  className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-slate-200 focus:outline-none focus:border-brand-orange"
                />
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-dark-850 border border-dark-750">
                <div>
                  <div className="font-semibold text-slate-200">Active in Discord</div>
                  <div className="text-[10px] text-slate-400">
                    If disabled, remains in database for historical records but hidden from Discord select menus.
                  </div>
                </div>
                <ToggleSwitch
                  checked={formEnabled}
                  onChange={setFormEnabled}
                  size="sm"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-dark-750">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => setModalMode(null)}
                >
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  {modalMode === "add" ? "Add Category" : "Apply Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        title={`Delete Category "${deleteConfirm.category?.label || deleteConfirm.category?.id}"?`}
        message="Deleting this category removes it from future refund choices. Existing refunds with this category ID will still display with a safe fallback name. If you only want to temporarily hide it, consider disabling it instead."
        confirmLabel="Delete Category"
        danger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirm({ isOpen: false, index: null, category: null })}
      />
    </div>
  );
};
