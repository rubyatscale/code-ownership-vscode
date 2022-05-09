import { reverseString } from './index';

describe('example method', () => {
  it('reverses as string', () => {
    // ARRANGE
    const forward = 'some string';

    // ACT
    const result = reverseString(forward);

    // ASSERT
    expect(result).toEqual('gnirts emos');
  });
});
