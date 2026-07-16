import { CatalogController } from './catalog.controller';

describe('CatalogController filter-option compatibility', () => {
  const catalogService = {
    getFilterOptions: jest.fn(),
    inventoryFilterOptions: jest.fn(),
  };
  const controller = new CatalogController(catalogService as never);

  beforeEach(() => jest.clearAllMocks());

  it('keeps the accepted frontend response when view is absent', async () => {
    catalogService.getFilterOptions.mockResolvedValue({ makes: ['Ford'] });

    await expect(controller.inventoryFilterOptions({})).resolves.toEqual({ makes: ['Ford'] });
    expect(catalogService.inventoryFilterOptions).not.toHaveBeenCalled();
  });

  it('returns unified faceted options when view is explicit', async () => {
    const response = { contractVersion: 'unified-auction-rc-v1', view: 'usa', options: {} };
    catalogService.inventoryFilterOptions.mockResolvedValue(response);

    await expect(controller.inventoryFilterOptions({ view: 'usa' })).resolves.toBe(response);
    expect(catalogService.inventoryFilterOptions).toHaveBeenCalledWith({ view: 'usa' });
  });
});
