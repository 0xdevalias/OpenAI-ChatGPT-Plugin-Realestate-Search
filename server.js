const randomUserAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36"
];

class RealestateComAu {
  constructor(proxies = {}, debug = false) {
    this.API_BASE_URL = "https://lexa.realestate.com.au/graphql";
    this.AGENT_CONTACT_BASE_URL = "https://agent-contact.realestate.com.au";
    this.REQUEST_HEADERS = {
      "content-type": "application/json",
      "origin": "https://www.realestate.com.au",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "user-agent": randomUserAgents[Math.floor(Math.random() * randomUserAgents.length)]
    };
    this._MAX_SEARCH_PAGE_SIZE = 100;
    this._DEFAULT_SEARCH_PAGE_SIZE = 25;
    this.proxies = proxies;
    this.debug = debug;
    this.logger = console;
  }

  async search(
    limit = -1,
    start_page = 1,
    sold_limit = -1,
    channel = "buy",
    locations = [],
    surrounding_suburbs = true,
    exclude_no_sale_price = false,
    furnished = false,
    pets_allowed = false,
    ex_under_contract = false,
    min_price = 0,
    max_price = -1,
    min_bedrooms = 0,
    max_bedrooms = -1,
    property_types = [],
    min_bathrooms = 0,
    min_carspaces = 0,
    min_land_size = 0,
    construction_status = null,
    keywords = [],
    exclude_keywords = [],
    sort_type = null
  ) {
    const getQueryVariables = (page = start_page) => {
      const queryVariables = {
        channel: channel,
        page: page,
        pageSize: limit > -1 ? Math.min(limit, this._MAX_SEARCH_PAGE_SIZE) : this._DEFAULT_SEARCH_PAGE_SIZE,
        localities: locations.map(location => ({ searchLocation: location })),
        filters: {
          surroundingSuburbs: surrounding_suburbs,
          excludeNoSalePrice: exclude_no_sale_price,
          "ex-under-contract": ex_under_contract,
          furnished: furnished,
          petsAllowed: pets_allowed
        }
      };

      if (max_price !== null && max_price > -1 || (max_price !== null && min_price > 0)) {
        const priceFilter = {};
        if (max_price > -1) {
          priceFilter.maximum = max_price.toString();
        }
        if (min_price > 0) {
          priceFilter.minimum = min_price.toString();
        }
        queryVariables.filters.priceRange = priceFilter;
      }

      if (max_bedrooms !== null && max_bedrooms > -1 || (max_bedrooms !== null && min_bedrooms > 0)) {
        const bedsFilter = {};
        if (max_bedrooms > -1) {
          bedsFilter.maximum = max_bedrooms.toString();
        }
        if (min_bedrooms > 0) {
          bedsFilter.minimum = min_bedrooms.toString();
        }
        queryVariables.filters.bedroomsRange = bedsFilter;
      }

      if (property_types.length > 0) {
        queryVariables.filters.propertyTypes = property_types;
      }

      if (min_bathrooms !== null && min_bathrooms > 0) {
        queryVariables.filters.minimumBathroom = min_bathrooms.toString();
      }

      if (min_carspaces !== null && min_carspaces > 0) {
        queryVariables.filters.minimumCars = min_carspaces.toString();
      }

      if (min_land_size !== null && min_land_size > 0) {
        queryVariables.filters.landSize = { minimum: min_land_size.toString() };
      }

      if (construction_status) {
        queryVariables.filters.constructionStatus = construction_status;
      }

      if (keywords.length > 0) {
        queryVariables.filters.keywords = { terms: keywords };
      }

      if (sort_type) {
        queryVariables.sort_type = sort_type;
      }

      return queryVariables;
    };

    const getQuery = () => {
      if (channel === "buy") {
        return searchBuy.QUERY;
      }
      if (channel === "sold") {
        return searchSold.QUERY;
      }
      return searchRent.QUERY;
    };

    const getPayload = (queryVariables) => {
      return {
        operationName: "searchByQuery",
        variables: {
          query: JSON.stringify(queryVariables),
          testListings: false,
          nullifyOptionals: false
        },
        query: getQuery()
      };
    };

    const parseItems = (res) => {
      const data = res.data;
      const results = (data?.data?.[`${channel}Search`]?.results ?? {});

      const exactListings = (results?.exact?.items ?? []);
      const surroundingListings = (results?.surrounding?.items ?? []);

      const listings = [...exactListings, ...surroundingListings].map(listing => getListing(listing.listing ?? {}));

      // Filter listings that contain exclude_keywords
      if (exclude_keywords.length > 0) {
        const pattern = new RegExp(exclude_keywords.join("|"));
        return listings.filter(listing => !pattern.test(listing.description.toString()));
      }

      return listings;
    };

    const getCurrentPage = (kwargs) => {
      const currentQueryVariables = JSON.parse(kwargs.json.variables.query);
      return currentQueryVariables.page;
    };

    const nextPage = (kwargs) => {
      const current_page = getCurrentPage(kwargs);
      kwargs.json = getPayload(getQueryVariables(current_page + 1));
      return kwargs;
    };

    const isDone = (items, res, kwargs) => {
      const itemsCount = items.length;

      if (limit > -1 && itemsCount >= limit) {
        return true;
      }

      if (channel === "sold" && sold_limit > -1 && itemsCount >= sold_limit) {
        return true;
      }

      const data = res.data;
      const results = (data?.data?.[`${channel}Search`]?.results ?? {});

      const pagination = results.pagination;
      if (!pagination.moreResultsAvailable) {
        return true;
      }

      return false;
    };

    const listings = await this._scroll(
      "",
      "POST",
      parseItems,
      nextPage,
      isDone,
      { json: getPayload(getQueryVariables(1)) }
    );

    return listings;
  }

  async contact_agent(listing_id, from_address, from_name, message, subject = "", from_phone = "") {
    const payload = {
      lookingTo: subject,
      name: from_name,
      fromAddress: from_address,
      fromPhone: from_phone,
      message: message,
      likeTo: []
    };

    const res = await this._post(`/contact-agent/listing/${listing_id}`, {
      base_url: this.AGENT_CONTACT_BASE_URL,
      headers: this.REQUEST_HEADERS,
      json: payload,
      proxies: this.proxies
    });

    return res;
  }

  async _scroll(initial_data, method, parse_items, next_page, is_done, options) {
    let data = initial_data;
    let items = [];
    let response = null;

    while (!is_done(items, response, options)) {
      try {
        response = await this._request(method, options);
        data = await parse_items(response);
        items.push(...data);

        options = next_page(options);
      } catch (error) {
        console.error("Error occurred while scrolling:", error);
        break;
      }
    }

    return items;
  }

  async _post(endpoint, options) {
    const url = new URL(endpoint, options.base_url);
    const headers = { ...options.headers };
    const body = JSON.stringify(options.json);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: body,
        agent: options.agent,
        compress: options.compress,
        timeout: options.timeout,
        followRedirects: options.followRedirects,
        proxy: options.proxies
      });

      const json = await response.json();
      return json;
    } catch (error) {
      console.error("Error occurred during POST request:", error);
      throw error;
    }
  }

  async _request(method, options) {
    const url = new URL(options.url, options.base_url);
    const headers = { ...options.headers };
    const body = JSON.stringify(options.json);

    try {
      const response = await fetch(url, {
        method: method,
        headers: headers,
        body: body,
        agent: options.agent,
        compress: options.compress,
        timeout: options.timeout,
        followRedirects: options.followRedirects,
        proxy: options.proxies
      });

      const json = await response.json();
      return json;
    } catch (error) {
      console.error("Error occurred during request:", error);
      throw error;
    }
  }
}

const searchParams = {
  limit: 10,
  start_page: 1,
  channel: 'rent',
  locations: ['Sydney', 'Melbourne'],
  min_price: 50,
  max_price: 1000,
  min_bedrooms: 2,
  max_bedrooms: 4
};

realestate.search(searchParams)
  .then(listings => {
    console.log('Listings:');
    console.log(listings);
  })
  .catch(error => {
    console.error('Error occurred while searching:', error);
  });