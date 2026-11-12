import React, { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import './CustomDropdown.css';

const CustomDropdown = ({
  options = [],
  value,
  onChange,
  placeholder = 'Select option...',
  className = '',
  size = 'md', // sm, md, lg
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard users land on the selected option when the menu opens
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const target = listRef.current.querySelector('[aria-selected="true"]') || listRef.current.querySelector('[role="option"]');
    target?.focus();
  }, [isOpen]);

  // Find currently selected label
  const selectedOption = options.find(opt => opt.value === value) || (typeof value === 'string' && value ? { label: value, value } : null);

  const close = (restoreFocus) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const handleSelect = (opt) => {
    if (disabled) return;
    onChange(opt.value);
    close(true);
  };

  const handleOptionKeyDown = (e, opt) => {
    const items = listRef.current ? Array.from(listRef.current.querySelectorAll('[role="option"]')) : [];
    const index = items.indexOf(e.currentTarget);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect(opt);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[Math.min(items.length - 1, index + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[Math.max(0, index - 1)]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close(e.key === 'Escape');
    }
  };

  const handleTriggerKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div
      className={`custom-dropdown-root ${size} ${disabled ? 'disabled' : ''} ${className}`}
      ref={dropdownRef}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`custom-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
      >
        <span className="custom-dropdown-selected">
          {selectedOption ? selectedOption.label : <span className="custom-dropdown-placeholder">{placeholder}</span>}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`custom-dropdown-arrow ${isOpen ? 'rotate' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="custom-dropdown-menu">
          <div className="custom-dropdown-list" role="listbox" id={listId} ref={listRef} aria-labelledby={ariaLabelledBy ? ariaLabelledBy.split(' ')[0] : undefined} aria-label={ariaLabel}>
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  className={`custom-dropdown-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelect(opt)}
                  onKeyDown={(e) => handleOptionKeyDown(e, opt)}
                >
                  <span className="custom-dropdown-item-label">{opt.label}</span>
                  {isSelected && (
                    <span className="custom-dropdown-item-check" aria-hidden="true">
                      <Check size={13} strokeWidth={2.5} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomDropdown;
