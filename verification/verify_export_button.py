
from playwright.sync_api import sync_playwright
import os

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Mock chrome.storage.local
    page.add_init_script("""
    window.chrome = {
        runtime: {
            sendMessage: async (msg) => {
                console.log('Message sent:', msg);
                if (msg.type === 'GET_SETTINGS') return {};
                return { ok: true };
            },
            getURL: (path) => path
        },
        storage: {
            local: {
                get: async (keys) => {
                    return {
                        index: [],
                        folderStructure: {},
                        tagColors: {}
                    };
                },
                set: async (items) => {}
            }
        },
        downloads: {
            download: async () => {}
        }
    };
    """)

    # Load options.html from file
    cwd = os.getcwd()
    options_path = os.path.join(cwd, 'claude-backup-organizer', 'options.html')
    page.goto(f'file://{options_path}')

    # Wait for the button to appear
    export_all_btn = page.locator('#exportAll')

    # Take screenshot of the Advanced Controls section
    header = page.locator('header')
    header.screenshot(path='verification/export_button.png')

    print("Screenshot saved to verification/export_button.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
