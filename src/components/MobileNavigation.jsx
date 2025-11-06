import React from 'react';

function MobileNavigation({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'daily', label: 'Daily', icon: '📅' },
    { id: 'weekly', label: 'Weekly', icon: '📋' },
    { id: 'staff', label: 'Staff', icon: '👥' },
    { id: 'timeoff', label: 'Time Off', icon: '⏰' },
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
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export default MobileNavigation;
