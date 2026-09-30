import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import './CustomDropdown.css';

const CustomDropdown = ({ 
  options = [], 
  value, 
  onChange, 
  placeholder = 'Select option...', 
  className = '',
  size = 'md', // sm, md, lg
  disabled = false 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

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

  // Find currently selected label
  const selectedOption = options.find(opt => opt.value === value) || (typeof value === 'string' ? { label: value, value } : null);

  const handleSelect = (opt) => {
    if (disabled) return;
    onChange(opt.value);
    setIsOpen(false);
  };

  return (
    <div 
      className={`custom-dropdown-root ${size} ${disabled ? 'disabled' : ''} ${className}`}
      ref={dropdownRef}
    >
      <button
        type="button"
        className={`custom-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="custom-dropdown-selected">
          {selectedOption ? selectedOption.label : <span className="custom-dropdown-placeholder">{placeholder}</span>}
        </span>
        <ChevronDown 
          size={14} 
          className={`custom-dropdown-arrow ${isOpen ? 'rotate' : ''}`} 
        />
      </button>

      {isOpen && (
        <div className="custom-dropdown-menu">
          <div className="custom-dropdown-list">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  className={`custom-dropdown-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelect(opt)}
                >
                  <span className="custom-dropdown-item-label">{opt.label}</span>
                  {isSelected && (
                    <span className="custom-dropdown-item-check">
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
