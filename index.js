/*
 *
 * The MIT License (MIT)
 * Copyright (c) 2018 Jerome Quere
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const puppeteer = require("puppeteer");

/**
 * General description.
 * - We use puppeteer to create a virtual browser in which in open WORKER_COUNT page.
 * - We concurrently load different page of transaction in each browser page.
 * - We inject a script in each page when the DOM is loaded that will return an array of transaction when ready.
 */

const

    /**
     * URL you want to fetch transactions from.
     */
    URL = process.argv[2] || "http://localhost:8080",

    /**
     * The number of transaction per page.
     */
    PAGE_SIZE = 50,

    /**
     * The total number of page
     */
    PAGE_COUNT = 100,

    /**
     * The number of worker you want to start. Worker will fetch transaction concurrently
     */
    WORKER_COUNT = 30
;

/**
 * This method is injected inside the puppeteer page and will return a promise that
 * is resolved with the transactions as soon as they are loaded.
 */
const injectedScript = () => {
    // Do not declare anything here or we might override global variables in the page.

    return new Promise( resolve => {

        /** DOM Elements */
        const $body = document.body;
        const $dvTable = document.getElementById("dvTable");
        let   $fm = document.getElementById("fm");

        /** Theses functions return true if transaction are found in the DOM */
        const isDvTableReady = () => $dvTable.children.length;
        const isFmReady = () => $fm && $fm.contentWindow.document.body.children.length;
        const isReady = () => isDvTableReady() || isFmReady();

        /** Receives a NodeList of tr loop through them and return a transaction array. */
        const parseTable = trs => {
            const results = []
            for (const tr of trs) {
                results.push({
                    account: tr.children[0].innerHTML,
                    transaction: tr.children[1].innerHTML,
                    amount: parseFloat(tr.children[2].innerHTML),
                    currency: tr.children[2].innerHTML.substr(-1)
                })
            }
            // Remove the table head
            results.shift()
            return results
        }

        /** Call parseTable with the correct tr whether they are in $dvTable or $fm. */
        const parseDom = () => {
            if (isDvTableReady()) return parseTable($dvTable.querySelectorAll("tr"))
            if (isFmReady()) return parseTable($fm.contentWindow.document.body.querySelectorAll("tr"))
            return null
        }

        /** Will resolve the promise if transaction are ready */
        const resolveIfReady = () => isReady() && resolve(parseDom())

        /** Watch the $body DOM to see if $dvTable if ready. */
        $body.addEventListener("DOMSubtreeModified", resolveIfReady)

        /** Watch the $body DOM in case an iframe was added so we can add listener on it. */
        $body.addEventListener("DOMSubtreeModified", () => {

            // No need to call getElementById if we already found $fm.
            const $iframe = $fm || document.getElementById("fm")

            // If we found the iframe was not there before we add a listener
            if ($iframe !== $fm)
                $iframe.contentWindow.document.body.addEventListener("DOMSubtreeModified", resolveIfReady)
            $fm = $iframe
        })

        // If the content is already ready let"s resolve it.
        resolveIfReady()
    })
}

/**
 * This class manage a pool of puppeteer page to fetch multiple URL concurrently.
 */
class FetcherPool {

    /**
     * This is the main class entry point.
     */
    async run({ URL, PAGE_SIZE, PAGE_COUNT, WORKER_COUNT }) {
        /** Queue of url to fetch **/
        this.urls = []

        /** List of already fetched transactions */
        this.transactions = [];

        // Start puppeteer with no sandbox ( Be careful with that ;-) )
        this.browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] })

        // Create WORKER_COUNT puppeteer page
        this.pages = await Promise.all(
            Array(WORKER_COUNT).fill("").map(() => this._buildPage())
        );

        // Generate all the url to fetch an add them with _addUrl.
        await Promise.all(
            Array(PAGE_COUNT).fill("").map((_, i) => this._addUrl(`${URL}?start=${i * PAGE_SIZE}`))
        );

        // When we got all the transactions close the browser and return them.
        await this.browser.close();
        return this.transactions;
    }

    /**
     * Load a url inside a puppeteer page on when the DOM is loaded inject the script.
     */
    async _fetchTransactions(page, url) {
        await page.goto(url, { waitUntil: "domcontentloaded" })
        return await page.evaluate(injectedScript)
    }

    /**
     * Register a url to be fetched.
     */
    async _addUrl(url) {

        if (this.pages.length) {
            // At least on page is available so we pop it so nobody can use it while we work with it.
            const page = this.pages.pop();

            // fetchTransaction from the url and add them to this.transactions
            this.transactions.push(...await this._fetchTransactions(page, url));

            // Register the page so other can reuse it.
            this.pages.push(page);

            // If we have url in the queue we shift it and call addUrl to start the fetching process.
            if (this.urls.length)
                return this._addUrl(this.urls.shift())
        } else {
            // If no page was available we add the url to the queue.
            this.urls.push(url);
        }
    }

    /**
     * Create a correctly configured puppeteer page.
     */
    async _buildPage() {
        const page = await this.browser.newPage()
        page.on("dialog", async dialog => {
            await dialog.dismiss()
            await page.click("#btnGenerate")
        })
        return page;
    }
}

/**
 *
 */
void async function main() {
    const transactions = await new FetcherPool().run({URL, PAGE_SIZE, PAGE_COUNT, WORKER_COUNT});
    console.log(JSON.stringify(transactions));
}();