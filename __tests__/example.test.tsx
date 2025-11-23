import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Example test - you can expand this
describe('Example Test Suite', () => {
  it('should pass a basic test', () => {
    expect(true).toBe(true);
  });

  it('can render a simple component', () => {
    const TestComponent = () => <div>Hello World</div>;
    render(<TestComponent />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });
});
