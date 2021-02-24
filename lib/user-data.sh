#!/bin/sh
sudo yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_arm64/amazon-ssm-agent.rpm
restart amazon-ssm-agent
cd ~

# Install gemini
wget https://github.com/a-h/gemini/releases/download/v0.0.44/gemini_0.0.44_Linux_arm64.tar.gz
tar -xf gemini_0.0.44_Linux_arm64.tar.gz
sudo mv gemini /usr/bin/

# Create a content directory.
sudo mkdir -p /srv/gemini

# Create a config directory.
sudo mkdir -p /etc/gemini

# Write out a homepage.
echo "# Hello, World" | sudo tee -a /srv/gemini/index.gmi > /dev/null

# Create the OpenSSL config.
sudo openssl ecparam -genkey -name secp384r1 -out /etc/gemini/capsule.adrianhesketh.com.key
sudo openssl req -new -x509 -sha256 -key /etc/gemini/capsule.adrianhesketh.com.key -out /etc/gemini/capsule.adrianhesketh.com.crt -days 3650 -subj "/C=/ST=/L=/O=/OU=/CN=capsule.adrianhesketh.com"

# Create the geminid systemd service.
sudo tee /etc/systemd/system/geminid.service > /dev/null << 'EOF'
[Unit]
Description=geminid

[Service]
Type=simple
Restart=always
WorkingDirectory=/srv/gemini
ExecStart=/usr/bin/gemini serve --domain=capsule.adrianhesketh.com --certFile=/etc/gemini/capsule.adrianhesketh.com.crt --keyFile=/etc/gemini/capsule.adrianhesketh.com.key --path=/srv/gemini
EOF

# Start and enable geminid on startup.
sudo systemctl start geminid
sudo systemctl enable geminid
