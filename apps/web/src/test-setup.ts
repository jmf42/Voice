import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import React from 'react';

class MockIntersectionObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
    takeRecords() { return []; }
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as unknown as typeof IntersectionObserver);

vi.mock('./components/CyberBackground3D.js', () => ({
    CyberBackground3D: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'mock-cyber-bg' }, children),
}));
