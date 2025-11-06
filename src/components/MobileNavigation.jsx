import React from 'react';

interface MobileNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const MobileNavigation: React.FC<MobileNavigationProps> = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'daily', label: 'Daily', icon: '📅' },
    { id: 'weekly', label: 'Weekly', icon: '📋' },
    { id: 'staff', label: 'Staff', icon: '👥' },
    { id: 'timeoff', label: 'Time Off', icon: '⏰' },
    { id: 'pto', label: 'PTO', icon: '🏖️' },
    { id: 'vacancies', label: 'Vacancies', icon: '📝' },
  ];

  return (
    <div className="mobile-bottom-nav">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`mobile-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="mobile-tab-icon">{tab.icon}</span>
          <span className="mobile-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

export default MobileNavigation;
