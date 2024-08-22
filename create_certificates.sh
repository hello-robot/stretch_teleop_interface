echo "Generating web interface certs..."
cd certificates
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64" 
chmod +x mkcert-v*-linux-amd64
sudo cp mkcert-v*-linux-amd64 /usr/local/bin/mkcert
CAROOT=`pwd` mkcert --install
mkdir -p ~/.local/share/mkcert
rm -rf ~/.local/share/mkcert/root*
cp root* ~/.local/share/mkcert
mkcert ${HELLO_FLEET_ID} ${HELLO_FLEET_ID}.local ${HELLO_FLEET_ID}.dev localhost 127.0.0.1 0.0.0.0 ::1 
rm mkcert-v*-linux-amd64
cd ..
touch .env
echo certfile=${HELLO_FLEET_ID}+6.pem >> .env
echo keyfile=${HELLO_FLEET_ID}+6-key.pem >> .env