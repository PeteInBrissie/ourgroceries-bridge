const API_URL = "https://www.ourgroceries.com/your-lists/";
const SIGN_IN_URL = "https://www.ourgroceries.com/sign-in";

export class OurGroceriesClient {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.cookies = new Map();
    this.teamId = null;
    this.authenticated = false;
  }

  saveCookies(response) {
    for (const sc of (response.headers.getSetCookie() || [])) {
      this.cookies.set(sc.split("=")[0], sc.split(";")[0]);
    }
  }

  cookieHeader() {
    return [...this.cookies.values()].join("; ");
  }

  async login() {
    if (this.authenticated) return;

    // Step 1: POST email
    let r = await fetch(SIGN_IN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "emailAddress=" + encodeURIComponent(this.username) + "&action=email-address",
      redirect: "manual"
    });
    this.saveCookies(r);

    // Step 2: POST password
    r = await fetch(SIGN_IN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": this.cookieHeader()
      },
      body: "emailAddress=" + encodeURIComponent(this.username)
        + "&password=" + encodeURIComponent(this.password)
        + "&action=sign-in",
      redirect: "manual"
    });
    this.saveCookies(r);

    if (!this.cookies.has("ourgroceries-auth")) {
      throw new Error("Login failed: no auth cookie received. Check credentials.");
    }

    // Step 3: GET /your-lists/ to extract teamId
    r = await fetch(API_URL, {
      headers: { "Cookie": this.cookieHeader() }
    });
    this.saveCookies(r);
    const html = await r.text();

    const teamIdMatch = html.match(/g_teamId\s*=\s*"([^"]+)"/);
    if (!teamIdMatch) {
      throw new Error("Login failed: could not extract teamId.");
    }

    this.teamId = teamIdMatch[1];
    this.authenticated = true;
  }

  async apiCall(command, data = {}) {
    await this.login();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cookie": this.cookieHeader()
      },
      body: JSON.stringify({
        command,
        teamId: this.teamId,
        ...data
      })
    });

    if (!response.ok) {
      // Session may have expired — reset and retry once
      if (response.status === 400 || response.status === 401) {
        this.authenticated = false;
        this.cookies.clear();
        await this.login();
        const retry = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Cookie": this.cookieHeader()
          },
          body: JSON.stringify({ command, teamId: this.teamId, ...data })
        });
        if (!retry.ok) throw new Error("API call '" + command + "' failed after re-auth: " + retry.status);
        return retry.json();
      }
      throw new Error("API call '" + command + "' failed: " + response.status);
    }

    return response.json();
  }

  async getLists() {
    const data = await this.apiCall("getOverview");
    return data.shoppingLists;
  }

  async getListItems(listId) {
    const data = await this.apiCall("getList", { listId });
    return data.list.items;
  }

  async getCategories(listId) {
    const data = await this.apiCall("getList", { listId });
    return data.list.categories || [];
  }

  async addItemToList(listId, value, options = {}) {
    const payload = { listId, value };
    if (options.categoryId) {
      payload.categoryId = options.categoryId;
    } else if (options.autoCategory) {
      payload.autoCategory = true;
    }
    if (options.note) payload.note = options.note;
    return this.apiCall("insertItem", payload);
  }

  async removeItemFromList(listId, itemId) {
    return this.apiCall("deleteItem", { listId, itemId });
  }

  async toggleItemCrossedOff(listId, itemId, crossedOff) {
    return this.apiCall("setItemCrossedOff", { listId, itemId, crossedOff });
  }

  async deleteAllCrossedOff(listId) {
    return this.apiCall("deleteAllCrossedOffItems", { listId });
  }

  async findListByName(name) {
    const lists = await this.getLists();
    const lower = name.toLowerCase();
    return lists.find(l => l.name.toLowerCase() === lower)
      || lists.find(l => l.name.toLowerCase().includes(lower))
      || null;
  }
}
